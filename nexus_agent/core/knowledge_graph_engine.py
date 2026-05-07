"""Knowledge Graph Engine for repository-scale code understanding.

This module builds an AST-based graph from a repository, tracks function calls
and dependencies, traces execution paths, computes blast radius, plans synchronized
multi-file refactors, and generates markdown wiki documentation.
"""

from __future__ import annotations

import ast
import io
import logging
import re
import tokenize
from collections import defaultdict, deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger(__name__)

_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@dataclass
class SymbolNode:
    """Represents a graph node for a code symbol."""

    symbol_id: str
    kind: str
    name: str
    qualname: str
    module: str
    file_path: str
    lineno: int
    end_lineno: int
    docstring: str = ""


@dataclass
class GraphEdge:
    """Represents a directed relationship between graph nodes."""

    edge_type: str
    source: str
    target: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class FunctionRecord:
    """Internal structure used while building call edges."""

    symbol_id: str
    module: str
    file_path: str
    node: ast.FunctionDef | ast.AsyncFunctionDef
    imports: dict[str, str]


@dataclass
class RepoGraph:
    """In-memory representation of the repository graph."""

    repo_root: str
    symbols: dict[str, SymbolNode] = field(default_factory=dict)
    edges: list[GraphEdge] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        """Returns useful graph-level metrics."""
        edge_counts: dict[str, int] = defaultdict(int)
        for edge in self.edges:
            edge_counts[edge.edge_type] += 1

        return {
            "repo_root": self.repo_root,
            "symbol_count": len(self.symbols),
            "edge_count": len(self.edges),
            "edge_counts": dict(edge_counts),
            "module_count": sum(1 for s in self.symbols.values() if s.kind == "module"),
            "function_count": sum(
                1 for s in self.symbols.values() if s.kind in {"function", "method", "async_function"}
            ),
        }

    def to_dict(self) -> dict[str, Any]:
        """Serializes the graph to dictionary format."""
        return {
            "repo_root": self.repo_root,
            "symbols": {k: asdict(v) for k, v in self.symbols.items()},
            "edges": [asdict(edge) for edge in self.edges],
            "summary": self.summary(),
        }


@dataclass
class RefactorFileChange:
    """Planned file-level refactor edit."""

    file_path: str
    replacements: int
    updated_content: str


@dataclass
class RefactorPlan:
    """Refactor plan generated for synchronized multi-file rename."""

    repo_root: str
    rename_map: dict[str, str]
    changes: list[RefactorFileChange] = field(default_factory=list)

    @property
    def total_replacements(self) -> int:
        return sum(change.replacements for change in self.changes)

    def summary(self) -> dict[str, Any]:
        return {
            "repo_root": self.repo_root,
            "file_count": len(self.changes),
            "total_replacements": self.total_replacements,
            "rename_map": self.rename_map,
            "files": [change.file_path for change in self.changes],
        }


class _DefinitionCollector(ast.NodeVisitor):
    """Collects class and function definitions with qualified names."""

    def __init__(
        self,
        module_name: str,
        relative_file_path: str,
        module_imports: dict[str, str],
    ) -> None:
        self.module_name = module_name
        self.relative_file_path = relative_file_path
        self.module_imports = module_imports
        self.scope_stack: list[str] = []
        self.symbols: list[SymbolNode] = []
        self.function_records: list[FunctionRecord] = []

    def visit_ClassDef(self, node: ast.ClassDef) -> Any:
        qualname = ".".join([*self.scope_stack, node.name])
        self.symbols.append(
            SymbolNode(
                symbol_id=f"symbol::{self.module_name}.{qualname}",
                kind="class",
                name=node.name,
                qualname=qualname,
                module=self.module_name,
                file_path=self.relative_file_path,
                lineno=node.lineno,
                end_lineno=getattr(node, "end_lineno", node.lineno),
                docstring=ast.get_docstring(node) or "",
            )
        )

        self.scope_stack.append(node.name)
        self.generic_visit(node)
        self.scope_stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> Any:
        self._collect_function(node, is_async=False)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> Any:
        self._collect_function(node, is_async=True)

    def _collect_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef, is_async: bool) -> None:
        qualname = ".".join([*self.scope_stack, node.name])
        if self.scope_stack and self.scope_stack[-1] != node.name:
            kind = "method"
        else:
            kind = "async_function" if is_async else "function"

        symbol_id = f"symbol::{self.module_name}.{qualname}"
        self.symbols.append(
            SymbolNode(
                symbol_id=symbol_id,
                kind=kind,
                name=node.name,
                qualname=qualname,
                module=self.module_name,
                file_path=self.relative_file_path,
                lineno=node.lineno,
                end_lineno=getattr(node, "end_lineno", node.lineno),
                docstring=ast.get_docstring(node) or "",
            )
        )
        self.function_records.append(
            FunctionRecord(
                symbol_id=symbol_id,
                module=self.module_name,
                file_path=self.relative_file_path,
                node=node,
                imports=self.module_imports,
            )
        )

        self.scope_stack.append(node.name)
        self.generic_visit(node)
        self.scope_stack.pop()


class _CallCollector(ast.NodeVisitor):
    """Collects call expressions while skipping nested function or class bodies."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def collect(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
        for statement in node.body:
            self.visit(statement)
        return self.calls

    def visit_Call(self, node: ast.Call) -> Any:
        expr = self._expr_to_string(node.func)
        if expr:
            self.calls.append(expr)
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> Any:
        return None

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> Any:
        return None

    def visit_ClassDef(self, node: ast.ClassDef) -> Any:
        return None

    def _expr_to_string(self, node: ast.AST) -> str:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            prefix = self._expr_to_string(node.value)
            return f"{prefix}.{node.attr}" if prefix else node.attr
        return ""


class KnowledgeGraphEngine:
    """AST-based graph engine for repository intelligence workflows."""

    def __init__(self, ignore_directories: Iterable[str] | None = None) -> None:
        self.ignore_directories = set(
            ignore_directories
            or {
                ".git",
                ".venv",
                "venv",
                "node_modules",
                "dist",
                "build",
                "__pycache__",
                ".pytest_cache",
                "nexus_agent.egg-info",
            }
        )

    def build_repo_graph(self, repo_root: str, include_tests: bool = True) -> RepoGraph:
        """Builds a repository graph from Python files using AST analysis."""
        repo_root_path = Path(repo_root).resolve()
        graph = RepoGraph(repo_root=str(repo_root_path))

        module_symbol_ids: dict[str, str] = {}
        module_imports: dict[str, dict[str, str]] = {}
        module_import_targets: dict[str, set[str]] = defaultdict(set)
        function_records: list[FunctionRecord] = []

        for file_path in self._iter_python_files(repo_root_path, include_tests=include_tests):
            relative_file_path = file_path.relative_to(repo_root_path).as_posix()
            module_name = self._module_name_from_path(repo_root_path, file_path)

            source = file_path.read_text(encoding="utf-8")
            try:
                tree = ast.parse(source, filename=str(file_path))
            except SyntaxError as exc:
                logger.warning("Skipping syntax-invalid file %s: %s", relative_file_path, exc)
                continue

            module_symbol_id = f"module::{module_name}"
            graph.symbols[module_symbol_id] = SymbolNode(
                symbol_id=module_symbol_id,
                kind="module",
                name=module_name,
                qualname=module_name,
                module=module_name,
                file_path=relative_file_path,
                lineno=1,
                end_lineno=max(1, len(source.splitlines())),
                docstring=ast.get_docstring(tree) or "",
            )
            module_symbol_ids[module_name] = module_symbol_id

            imports = self._extract_import_aliases(tree, module_name)
            module_imports[module_name] = imports
            module_import_targets[module_name].update(self._extract_import_targets(tree, module_name))

            collector = _DefinitionCollector(
                module_name=module_name,
                relative_file_path=relative_file_path,
                module_imports=imports,
            )
            collector.visit(tree)

            for symbol in collector.symbols:
                graph.symbols[symbol.symbol_id] = symbol
                graph.edges.append(
                    GraphEdge(
                        edge_type="defines",
                        source=module_symbol_id,
                        target=symbol.symbol_id,
                        metadata={"kind": symbol.kind},
                    )
                )

            function_records.extend(collector.function_records)

        fqn_index, basename_index, module_basename_index = self._build_symbol_indexes(graph)

        self._build_dependency_edges(
            graph=graph,
            module_symbol_ids=module_symbol_ids,
            module_import_targets=module_import_targets,
            fqn_index=fqn_index,
        )

        self._build_call_edges(
            graph=graph,
            function_records=function_records,
            fqn_index=fqn_index,
            basename_index=basename_index,
            module_basename_index=module_basename_index,
            module_imports=module_imports,
        )

        return graph

    def trace_execution_flow(
        self,
        graph: RepoGraph,
        entry_symbol: str,
        max_depth: int = 6,
    ) -> dict[str, Any]:
        """Traces execution flow from an entry symbol over call edges."""
        entry_id = self._resolve_symbol_reference(graph, entry_symbol)
        if entry_id is None:
            raise ValueError(f"Unknown entry symbol: {entry_symbol}")

        outgoing = self._adjacency(graph, edge_types={"calls"})

        visited: list[str] = []
        paths: list[list[str]] = []

        stack: list[tuple[str, list[str], int]] = [(entry_id, [entry_id], 0)]
        while stack:
            node_id, path, depth = stack.pop()
            if node_id not in visited:
                visited.append(node_id)

            targets = sorted(outgoing.get(node_id, []))
            if depth >= max_depth or not targets:
                paths.append(path)
                continue

            for target in reversed(targets):
                if target in path:
                    paths.append(path + [target])
                    continue
                stack.append((target, path + [target], depth + 1))

        return {
            "entry_symbol": self._symbol_label(graph, entry_id),
            "entry_symbol_id": entry_id,
            "visited_symbols": [self._symbol_label(graph, sid) for sid in visited],
            "paths": [[self._symbol_label(graph, sid) for sid in path] for path in paths],
            "max_depth": max_depth,
        }

    def analyze_blast_radius(
        self,
        graph: RepoGraph,
        changed_symbols: list[str],
        depth: int = 2,
    ) -> dict[str, Any]:
        """Analyzes likely impact surface around changed symbols."""
        if not changed_symbols:
            raise ValueError("changed_symbols must not be empty")

        resolved_ids = {
            resolved
            for symbol in changed_symbols
            for resolved in [self._resolve_symbol_reference(graph, symbol)]
            if resolved is not None
        }
        if not resolved_ids:
            raise ValueError("None of the changed symbols were found in the graph")

        outgoing = self._adjacency(graph, edge_types={"calls", "imports", "defines"})
        incoming = self._reverse_adjacency(outgoing)

        forward = self._bfs(resolved_ids, outgoing, depth)
        reverse = self._bfs(resolved_ids, incoming, depth)

        direct_callers = set()
        direct_callees = set()
        for symbol_id in resolved_ids:
            direct_callers.update(incoming.get(symbol_id, set()))
            direct_callees.update(outgoing.get(symbol_id, set()))

        impacted_ids = set(resolved_ids) | forward | reverse
        impacted_internal_ids = {
            sid for sid in impacted_ids if sid in graph.symbols and not sid.startswith("external::")
        }

        impacted_files = sorted(
            {
                graph.symbols[sid].file_path
                for sid in impacted_internal_ids
                if graph.symbols[sid].file_path
            }
        )

        return {
            "changed_symbols": [self._symbol_label(graph, sid) for sid in sorted(resolved_ids)],
            "direct_callers": [self._symbol_label(graph, sid) for sid in sorted(direct_callers)],
            "direct_callees": [self._symbol_label(graph, sid) for sid in sorted(direct_callees)],
            "impacted_symbols": [self._symbol_label(graph, sid) for sid in sorted(impacted_ids)],
            "impacted_file_count": len(impacted_files),
            "impacted_files": impacted_files,
            "depth": depth,
        }

    def plan_sync_refactor(
        self,
        repo_root: str,
        rename_map: dict[str, str],
        include_tests: bool = True,
    ) -> RefactorPlan:
        """Creates synchronized cross-file identifier rename plan using token-level edits."""
        if not rename_map:
            raise ValueError("rename_map must not be empty")

        self._validate_rename_map(rename_map)

        repo_root_path = Path(repo_root).resolve()
        plan = RefactorPlan(repo_root=str(repo_root_path), rename_map=rename_map)

        for file_path in self._iter_python_files(repo_root_path, include_tests=include_tests):
            source = file_path.read_text(encoding="utf-8")
            updated, replacements = self._rename_identifiers_token_level(source, rename_map)
            if replacements == 0 or source == updated:
                continue

            plan.changes.append(
                RefactorFileChange(
                    file_path=file_path.relative_to(repo_root_path).as_posix(),
                    replacements=replacements,
                    updated_content=updated,
                )
            )

        return plan

    def apply_refactor_plan(self, plan: RefactorPlan) -> dict[str, Any]:
        """Applies a refactor plan to disk."""
        repo_root_path = Path(plan.repo_root)
        applied = 0
        for change in plan.changes:
            target_path = repo_root_path / change.file_path
            target_path.write_text(change.updated_content, encoding="utf-8")
            applied += 1

        return {
            "applied_files": applied,
            "total_replacements": plan.total_replacements,
            "files": [change.file_path for change in plan.changes],
        }

    def generate_wiki(self, graph: RepoGraph, output_dir: str) -> dict[str, Any]:
        """Generates markdown wiki pages from graph metadata."""
        output_root = Path(output_dir).resolve()
        output_root.mkdir(parents=True, exist_ok=True)

        modules = sorted(
            [symbol for symbol in graph.symbols.values() if symbol.kind == "module"],
            key=lambda s: s.module,
        )

        module_to_symbols: dict[str, list[SymbolNode]] = defaultdict(list)
        for symbol in graph.symbols.values():
            if symbol.kind == "module":
                continue
            module_to_symbols[symbol.module].append(symbol)

        outgoing = self._adjacency(graph, edge_types={"calls", "imports", "defines"})
        incoming = self._reverse_adjacency(outgoing)

        created_files: list[str] = []

        index_lines = [
            "# Nexus Knowledge Graph Wiki",
            "",
            f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
            "",
            "## Summary",
        ]
        for key, value in graph.summary().items():
            index_lines.append(f"- {key}: {value}")
        index_lines += ["", "## Modules"]

        for module in modules:
            module_file_name = f"module_{module.module.replace('.', '_')}.md"
            module_path = output_root / module_file_name
            created_files.append(module_path.name)

            index_lines.append(f"- [{module.module}]({module_file_name})")

            symbols = sorted(module_to_symbols.get(module.module, []), key=lambda item: item.qualname)
            lines = [
                f"# Module: {module.module}",
                "",
                f"Source: {module.file_path}",
                "",
            ]

            if module.docstring:
                lines += ["## Module Docstring", "", module.docstring, ""]

            lines += ["## Defined Symbols", ""]
            if symbols:
                for symbol in symbols:
                    lines.append(
                        f"- {symbol.kind}: {symbol.qualname} "
                        f"(line {symbol.lineno}, file {symbol.file_path})"
                    )
            else:
                lines.append("- No symbols found")

            lines += ["", "## Outgoing Relations", ""]
            out_targets = sorted(outgoing.get(module.symbol_id, set()))
            if out_targets:
                for target_id in out_targets:
                    lines.append(f"- {self._symbol_label(graph, module.symbol_id)} -> {self._symbol_label(graph, target_id)}")
            else:
                lines.append("- No module-level outgoing relations")

            lines += ["", "## Inbound Relations", ""]
            in_sources = sorted(incoming.get(module.symbol_id, set()))
            if in_sources:
                for source_id in in_sources:
                    lines.append(f"- {self._symbol_label(graph, source_id)} -> {self._symbol_label(graph, module.symbol_id)}")
            else:
                lines.append("- No inbound relations")

            module_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

        index_path = output_root / "index.md"
        index_path.write_text("\n".join(index_lines) + "\n", encoding="utf-8")
        created_files.insert(0, index_path.name)

        return {
            "output_dir": str(output_root),
            "files_created": created_files,
            "module_pages": len(modules),
        }

    def build_graph_and_generate_wiki(
        self,
        repo_root: str,
        output_dir: str,
        include_tests: bool = True,
    ) -> dict[str, Any]:
        """Convenience method for graph build and wiki generation in one call."""
        graph = self.build_repo_graph(repo_root=repo_root, include_tests=include_tests)
        wiki_result = self.generate_wiki(graph=graph, output_dir=output_dir)
        return {
            "graph_summary": graph.summary(),
            "wiki": wiki_result,
        }

    def _iter_python_files(self, repo_root: Path, include_tests: bool) -> list[Path]:
        files: list[Path] = []
        for path in repo_root.rglob("*.py"):
            if any(part in self.ignore_directories for part in path.parts):
                continue
            if not include_tests and "tests" in path.parts:
                continue
            files.append(path)
        return sorted(files)

    def _module_name_from_path(self, repo_root: Path, file_path: Path) -> str:
        relative = file_path.relative_to(repo_root).with_suffix("")
        parts = list(relative.parts)

        if parts and parts[-1] == "__init__":
            parts = parts[:-1]

        if not parts:
            return "root"

        return ".".join(parts)

    def _extract_import_aliases(self, tree: ast.AST, module_name: str) -> dict[str, str]:
        aliases: dict[str, str] = {}

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    alias_name = alias.asname or alias.name.split(".")[0]
                    aliases[alias_name] = alias.name
            elif isinstance(node, ast.ImportFrom):
                base_module = self._resolve_from_import_module(module_name, node.module, node.level)
                for alias in node.names:
                    alias_name = alias.asname or alias.name
                    if alias.name == "*":
                        continue
                    aliases[alias_name] = f"{base_module}.{alias.name}" if base_module else alias.name

        return aliases

    def _extract_import_targets(self, tree: ast.AST, module_name: str) -> set[str]:
        targets: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    targets.add(alias.name)
            elif isinstance(node, ast.ImportFrom):
                resolved = self._resolve_from_import_module(module_name, node.module, node.level)
                if resolved:
                    targets.add(resolved)
        return targets

    def _resolve_from_import_module(self, module_name: str, module: str | None, level: int) -> str:
        if level <= 0:
            return module or ""

        module_parts = module_name.split(".")
        if level >= len(module_parts):
            parent = []
        else:
            parent = module_parts[:-level]

        if module:
            return ".".join(parent + module.split("."))
        return ".".join(parent)

    def _build_symbol_indexes(
        self,
        graph: RepoGraph,
    ) -> tuple[dict[str, str], dict[str, set[str]], dict[tuple[str, str], set[str]]]:
        fqn_index: dict[str, str] = {}
        basename_index: dict[str, set[str]] = defaultdict(set)
        module_basename_index: dict[tuple[str, str], set[str]] = defaultdict(set)

        for symbol_id, symbol in graph.symbols.items():
            if symbol.kind == "module":
                fqn_index[symbol.module] = symbol_id
                basename_index[symbol.name].add(symbol_id)
                module_basename_index[(symbol.module, symbol.name)].add(symbol_id)
                continue

            full_name = f"{symbol.module}.{symbol.qualname}"
            fqn_index[full_name] = symbol_id
            basename = symbol.qualname.split(".")[-1]
            basename_index[basename].add(symbol_id)
            module_basename_index[(symbol.module, basename)].add(symbol_id)

        return fqn_index, basename_index, module_basename_index

    def _build_dependency_edges(
        self,
        graph: RepoGraph,
        module_symbol_ids: dict[str, str],
        module_import_targets: dict[str, set[str]],
        fqn_index: dict[str, str],
    ) -> None:
        for module_name, source_id in module_symbol_ids.items():
            for import_target in sorted(module_import_targets.get(module_name, set())):
                candidate_modules = self._candidate_modules(import_target)
                target_id = None
                for candidate in candidate_modules:
                    target_id = fqn_index.get(candidate)
                    if target_id:
                        break

                if not target_id:
                    target_id = self._ensure_external_node(
                        graph,
                        external_name=import_target,
                        kind="external_module",
                    )

                graph.edges.append(
                    GraphEdge(
                        edge_type="imports",
                        source=source_id,
                        target=target_id,
                        metadata={"import": import_target},
                    )
                )

    def _build_call_edges(
        self,
        graph: RepoGraph,
        function_records: list[FunctionRecord],
        fqn_index: dict[str, str],
        basename_index: dict[str, set[str]],
        module_basename_index: dict[tuple[str, str], set[str]],
        module_imports: dict[str, dict[str, str]],
    ) -> None:
        for record in function_records:
            call_collector = _CallCollector()
            calls = call_collector.collect(record.node)
            imports = module_imports.get(record.module, {})

            for call_expr in calls:
                resolved_id, resolution = self._resolve_call_target(
                    call_expr=call_expr,
                    module_name=record.module,
                    imports=imports,
                    fqn_index=fqn_index,
                    basename_index=basename_index,
                    module_basename_index=module_basename_index,
                )

                if resolved_id is None:
                    resolved_id = self._ensure_external_node(
                        graph,
                        external_name=call_expr,
                        kind="external_symbol",
                    )
                    resolution = "external"

                graph.edges.append(
                    GraphEdge(
                        edge_type="calls",
                        source=record.symbol_id,
                        target=resolved_id,
                        metadata={"expr": call_expr, "resolution": resolution},
                    )
                )

    def _resolve_call_target(
        self,
        call_expr: str,
        module_name: str,
        imports: dict[str, str],
        fqn_index: dict[str, str],
        basename_index: dict[str, set[str]],
        module_basename_index: dict[tuple[str, str], set[str]],
    ) -> tuple[str | None, str]:
        expr = call_expr.strip()
        if not expr:
            return None, "none"

        parts = expr.split(".")
        leaf = parts[-1]

        local_candidates = module_basename_index.get((module_name, leaf), set())
        if len(local_candidates) == 1:
            return next(iter(local_candidates)), "local-module"

        if len(parts) == 1:
            name = parts[0]
            imported_target = imports.get(name)
            if imported_target:
                imported_candidates = self._candidate_symbols(imported_target)
                for candidate in imported_candidates:
                    if candidate in fqn_index:
                        return fqn_index[candidate], "import-alias"

            if f"{module_name}.{name}" in fqn_index:
                return fqn_index[f"{module_name}.{name}"], "module-qualified"

            global_candidates = basename_index.get(name, set())
            if len(global_candidates) == 1:
                return next(iter(global_candidates)), "global-unique"
            return None, "unresolved"

        root = parts[0]
        if root in {"self", "cls", "super"}:
            method_candidates = module_basename_index.get((module_name, leaf), set())
            if len(method_candidates) == 1:
                return next(iter(method_candidates)), "self-cls"

        if root in imports:
            import_prefix = imports[root]
            remapped = ".".join([import_prefix, *parts[1:]])
            for candidate in self._candidate_symbols(remapped):
                if candidate in fqn_index:
                    return fqn_index[candidate], "import-prefix"

        for candidate in self._candidate_symbols(expr):
            if candidate in fqn_index:
                return fqn_index[candidate], "direct"

        global_leaf_candidates = basename_index.get(leaf, set())
        if len(global_leaf_candidates) == 1:
            return next(iter(global_leaf_candidates)), "leaf-unique"

        return None, "unresolved"

    def _candidate_modules(self, import_target: str) -> list[str]:
        parts = import_target.split(".")
        candidates: list[str] = []
        for i in range(len(parts), 0, -1):
            candidates.append(".".join(parts[:i]))
        return candidates

    def _candidate_symbols(self, qualified_name: str) -> list[str]:
        parts = qualified_name.split(".")
        candidates = [qualified_name]
        if len(parts) >= 2:
            for i in range(len(parts), 1, -1):
                candidates.append(".".join(parts[:i]))
        return candidates

    def _ensure_external_node(self, graph: RepoGraph, external_name: str, kind: str) -> str:
        node_id = f"external::{kind}::{external_name}"
        if node_id not in graph.symbols:
            graph.symbols[node_id] = SymbolNode(
                symbol_id=node_id,
                kind=kind,
                name=external_name,
                qualname=external_name,
                module="external",
                file_path="",
                lineno=0,
                end_lineno=0,
                docstring="",
            )
        return node_id

    def _adjacency(self, graph: RepoGraph, edge_types: set[str]) -> dict[str, set[str]]:
        adj: dict[str, set[str]] = defaultdict(set)
        for edge in graph.edges:
            if edge.edge_type in edge_types:
                adj[edge.source].add(edge.target)
        return adj

    def _reverse_adjacency(self, adjacency: dict[str, set[str]]) -> dict[str, set[str]]:
        reverse: dict[str, set[str]] = defaultdict(set)
        for source, targets in adjacency.items():
            for target in targets:
                reverse[target].add(source)
        return reverse

    def _bfs(self, seeds: set[str], adjacency: dict[str, set[str]], depth: int) -> set[str]:
        visited: set[str] = set(seeds)
        queue: deque[tuple[str, int]] = deque((seed, 0) for seed in seeds)

        while queue:
            node, current_depth = queue.popleft()
            if current_depth >= depth:
                continue
            for neighbor in adjacency.get(node, set()):
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                queue.append((neighbor, current_depth + 1))

        return visited - seeds

    def _resolve_symbol_reference(self, graph: RepoGraph, symbol_ref: str) -> str | None:
        if symbol_ref in graph.symbols:
            return symbol_ref

        normalized = symbol_ref.strip()
        if not normalized:
            return None

        normalized = normalized.replace("symbol::", "").replace("module::", "")

        for symbol_id, symbol in graph.symbols.items():
            if symbol.kind == "module":
                if symbol.module == normalized:
                    return symbol_id
            else:
                full_name = f"{symbol.module}.{symbol.qualname}"
                if full_name == normalized or symbol.qualname == normalized or symbol.name == normalized:
                    return symbol_id

        return None

    def _symbol_label(self, graph: RepoGraph, symbol_id: str) -> str:
        symbol = graph.symbols.get(symbol_id)
        if not symbol:
            return symbol_id
        if symbol.kind == "module":
            return symbol.module
        if symbol.module == "external":
            return f"external::{symbol.name}"
        return f"{symbol.module}.{symbol.qualname}"

    def _validate_rename_map(self, rename_map: dict[str, str]) -> None:
        for old_name, new_name in rename_map.items():
            if not _IDENTIFIER_RE.match(old_name):
                raise ValueError(f"Unsupported rename key '{old_name}'. Only Python identifiers are supported.")
            if not _IDENTIFIER_RE.match(new_name):
                raise ValueError(f"Unsupported rename value '{new_name}'. Only Python identifiers are supported.")

    def _rename_identifiers_token_level(self, source: str, rename_map: dict[str, str]) -> tuple[str, int]:
        token_stream = tokenize.generate_tokens(io.StringIO(source).readline)
        rewritten_tokens: list[tokenize.TokenInfo] = []
        replacements = 0

        for token in token_stream:
            if token.type == tokenize.NAME and token.string in rename_map:
                rewritten_tokens.append(
                    tokenize.TokenInfo(
                        token.type,
                        rename_map[token.string],
                        token.start,
                        token.end,
                        token.line,
                    )
                )
                replacements += 1
            else:
                rewritten_tokens.append(token)

        rewritten_source = tokenize.untokenize(rewritten_tokens)
        return rewritten_source, replacements


__all__ = [
    "SymbolNode",
    "GraphEdge",
    "RepoGraph",
    "RefactorFileChange",
    "RefactorPlan",
    "KnowledgeGraphEngine",
]
