import asyncio
import logging
from typing import Dict, Any, Callable, Awaitable

logger = logging.getLogger(__name__)

class LaneBasedQueue:
    """
    Implements a lane-based queue system to prevent bottlenecking.
    Messages from different channels are partitioned into independent queues (lanes).
    """
    def __init__(self):
        self.lanes: Dict[str, asyncio.Queue] = {
            "whatsapp": asyncio.Queue(),
            "slack": asyncio.Queue(),
            "discord": asyncio.Queue(),
            "system": asyncio.Queue()  # For internal agent-to-agent or system tasks
        }

    async def enqueue(self, channel: str, message: Dict[str, Any]):
        if channel not in self.lanes:
            logger.warning(f"Unknown channel '{channel}' falling back to 'system' lane.")
            channel = "system"
        await self.lanes[channel].put(message)
        logger.debug(f"Enqueued message to lane '{channel}'")

    async def dequeue(self, channel: str) -> Dict[str, Any]:
        if channel not in self.lanes:
            raise ValueError(f"Unknown channel: {channel}")
        return await self.lanes[channel].get()

    def task_done(self, channel: str):
        if channel in self.lanes:
            self.lanes[channel].task_done()

class MultiChannelGateway:
    """
    Handles incoming messages from various platforms and routes them to the orchestrator 
    through a lane-based queue to ensure fairness and prevent platform starvation.
    """
    def __init__(self, orchestrator_callback: Callable[[str, Dict[str, Any]], Awaitable[None]]):
        self.queue = LaneBasedQueue()
        self.orchestrator_callback = orchestrator_callback
        self.workers: list[asyncio.Task] = []

    async def receive_webhook(self, channel: str, payload: Dict[str, Any]):
        """
        Generic entry endpoint for webhooks (WhatsApp, Slack, Discord)
        """
        await self.queue.enqueue(channel, payload)

    async def _worker_loop(self, channel: str):
        """
        Background worker that continuously fetches from a specific lane
        and hands the job off to the orchestrator.
        """
        logger.info(f"Started worker for lane: {channel}")
        while True:
            try:
                message = await self.queue.dequeue(channel)
                logger.info(f"Processing message on {channel} lane...")
                
                # Pass off to orchestrator context
                await self.orchestrator_callback(channel, message)
                
                self.queue.task_done(channel)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error processing message in lane {channel}: {str(e)}")

    def start_workers(self):
        """Starts asynchronous consumption loops for each channel lane."""
        for channel in self.queue.lanes.keys():
            self.workers.append(asyncio.create_task(self._worker_loop(channel)))

    async def stop_workers(self):
        """Politely shuts down workers."""
        for w in self.workers:
            w.cancel()
        await asyncio.gather(*self.workers, return_exceptions=True)
        self.workers.clear()
