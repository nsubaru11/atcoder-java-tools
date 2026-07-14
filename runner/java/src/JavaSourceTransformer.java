import com.sun.source.tree.*;
import com.sun.source.util.*;

import java.io.*;
import java.net.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;
import java.util.stream.*;

import javax.lang.model.element.*;
import javax.lang.model.type.*;
import javax.tools.*;

/**
 * javac の構文木・シンボル解決を正典として提出用 Java ソースを生成します。
 */
final class JavaSourceTransformer {
	private static final Charset UTF_8 = StandardCharsets.UTF_8;
	private static final Pattern PUBLIC_TOKEN = Pattern.compile("\\bpublic\\s+");
	private static final Pattern LEADING_BLANK_LINES = Pattern.compile("\\A(?:[\\t ]*\\n)+");
	private final JavaCompiler compiler;
	private Path cachedRoot;
	private long cachedStamp = Long.MIN_VALUE;
	private LibraryIndex cachedIndex;

	JavaSourceTransformer() {
		compiler = ToolProvider.getSystemJavaCompiler();
		if (compiler == null) throw new IllegalStateException("No system Java compiler is available (JDK required).");
	}

	SourceTransformResult transform(final String rawSource, final Path librarySourceRoot,
	                                final boolean debug, final boolean autoImport) {
		return transform(rawSource, librarySourceRoot, debug, autoImport, true);
	}

	SourceTransformResult transform(final String rawSource, final Path librarySourceRoot,
	                                final boolean debug, final boolean autoImport, final boolean validate) {
		try {
			final Path root = librarySourceRoot.toAbsolutePath().normalize();
			if (!Files.isDirectory(root.resolve("lib"))) {
				return failure(rawSource, "library source root does not contain lib/: " + root);
			}
			final LibraryIndex index = libraryIndex(root);
			String source = normalize(rawSource);
			final List<String> addedImports = new ArrayList<>();

			Analysis analysis = analyze(source, index.classPath());
			if (autoImport) {
				final AutoImportResult inferred = inferImports(source, analysis, index);
				if (!inferred.error().isEmpty()) return failure(source, inferred.error());
				if (!inferred.imports().isEmpty()) {
					addedImports.addAll(inferred.imports());
					source = insertImports(source, analysis, inferred.imports());
					analysis = analyze(source, index.classPath());
				}
			}

			if (analysis.hasErrors()) return failure(source, analysis);
			final List<Path> dependencies = collectDependencies(analysis, index);
			final BundleOutput bundled = bundle(source, analysis, dependencies, root, debug);
			if (validate) {
				final Analysis validation = analyze(bundled.source(), null);
				if (validation.hasErrors()) return failure(bundled.source(), validation);
			}
			return new SourceTransformResult(0, bundled.source(), "", bundled.inlined(), List.copyOf(addedImports), List.of());
		} catch (final Exception exception) {
			return failure(rawSource, exception.toString());
		}
	}

	private SourceTransformResult failure(final String source, final String diagnostics) {
		return new SourceTransformResult(1, source, diagnostics, List.of(), List.of(), List.of());
	}

	private SourceTransformResult failure(final String source, final Analysis analysis) {
		return new SourceTransformResult(1, source, analysis.diagnostics(), List.of(), List.of(), analysis.diagnosticItems());
	}

	private LibraryIndex libraryIndex(final Path root) throws IOException {
		final long stamp;
		try (Stream<Path> files = Files.walk(root.resolve("lib"))) {
			long fingerprint = 1L;
			for (final Path path : files.filter(file -> file.toString().endsWith(".java")).sorted().toList()) {
				fingerprint = 31L * fingerprint + root.relativize(path).toString().hashCode();
				fingerprint = 31L * fingerprint + Files.getLastModifiedTime(path).toMillis();
				fingerprint = 31L * fingerprint + Files.size(path);
			}
			stamp = fingerprint;
		}
		if (root.equals(cachedRoot) && stamp == cachedStamp && cachedIndex != null) return cachedIndex;
		final Map<String, List<LibraryType>> bySimpleName = new HashMap<>();
		final Map<String, LibraryType> byFqcn = new HashMap<>();
		try (Stream<Path> files = Files.walk(root.resolve("lib"))) {
			for (final Path file : files.filter(path -> path.toString().endsWith(".java")).sorted().toList()) {
				// Public importable types follow src/lib/<package>/<ClassName>.java by project policy.
				// Deriving the index from that canonical path avoids parsing every library file on first paste.
				final String relative = root.relativize(file).toString().replace(File.separatorChar, '.');
				final String fqcn = relative.substring(0, relative.length() - ".java".length());
				final String simpleName = file.getFileName().toString().replaceFirst("\\.java$", "");
				final LibraryType libraryType = new LibraryType(simpleName, fqcn, file.toAbsolutePath().normalize());
				bySimpleName.computeIfAbsent(simpleName, ignored -> new ArrayList<>()).add(libraryType);
				byFqcn.put(fqcn, libraryType);
			}
		}
		final Path classPath = root.resolve(".compiled-library");
		compileLibrary(byFqcn.values().stream().map(LibraryType::path).distinct().toList(), classPath);
		cachedRoot = root;
		cachedStamp = stamp;
		cachedIndex = new LibraryIndex(bySimpleName, byFqcn, classPath, new HashMap<>());
		return cachedIndex;
	}

	private void compileLibrary(final List<Path> sources, final Path classPath) throws IOException {
		if (Files.exists(classPath)) {
			try (Stream<Path> files = Files.walk(classPath)) {
				for (final Path path : files.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
			}
		}
		Files.createDirectories(classPath);
		final DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
		try (StandardJavaFileManager fileManager = compiler.getStandardFileManager(diagnostics, Locale.ROOT, UTF_8)) {
			final Iterable<? extends JavaFileObject> units = fileManager.getJavaFileObjectsFromPaths(sources);
			final Boolean success = compiler.getTask(null, fileManager, diagnostics,
					List.of("-encoding", "UTF-8", "-proc:none", "-implicit:none", "-d", classPath.toString()),
					null, units).call();
			if (!Boolean.TRUE.equals(success)) {
				throw new IOException("library classpath compilation failed:\n" + diagnostics.getDiagnostics().stream()
						.map(diagnostic -> diagnostic.getKind() + " " + diagnostic.getMessage(Locale.ROOT))
						.collect(Collectors.joining("\n")));
			}
		}
	}

	private AutoImportResult inferImports(final String source, final Analysis analysis, final LibraryIndex index) {
		final Set<String> existing = new HashSet<>();
		for (final ImportTree importTree : analysis.solution().getImports()) {
			existing.add(importTree.getQualifiedIdentifier().toString());
		}
		final Set<String> localTypes = analysis.solution().getTypeDecls().stream()
				.filter(ClassTree.class::isInstance).map(ClassTree.class::cast)
				.map(type -> type.getSimpleName().toString()).collect(Collectors.toSet());
		final Set<String> unresolved = new TreePathScanner<String, Void>() {
			final Set<String> names = new TreeSet<>();
			@Override public String visitIdentifier(final IdentifierTree node, final Void unused) {
				final Element element = analysis.trees().getElement(getCurrentPath());
				if (element == null || element.asType().getKind() == TypeKind.ERROR) names.add(node.getName().toString());
				return super.visitIdentifier(node, unused);
			}
			Set<String> scanNames() { scan(analysis.solution(), null); return names; }
		}.scanNames();

		final List<String> imports = new ArrayList<>();
		for (final String name : unresolved) {
			if (localTypes.contains(name)) continue;
			final List<LibraryType> candidates = index.bySimpleName().getOrDefault(name, List.of());
			final List<LibraryType> uncovered = candidates.stream().filter(candidate ->
					!existing.contains(candidate.fqcn()) &&
					!existing.contains(candidate.fqcn().substring(0, candidate.fqcn().lastIndexOf('.')) + ".*"))
					.toList();
			final int minimumDepth = uncovered.stream().mapToInt(candidate ->
					candidate.fqcn().split("\\.").length).min().orElse(Integer.MAX_VALUE);
			final List<LibraryType> preferred = uncovered.stream().filter(candidate ->
					candidate.fqcn().split("\\.").length == minimumDepth).toList();
			if (preferred.size() > 1) {
				return new AutoImportResult(List.of(), "library type is ambiguous: " + name + " -> " +
						preferred.stream().map(LibraryType::fqcn).collect(Collectors.joining(", ")));
			}
			if (preferred.size() == 1) {
				final String fqcn = preferred.getFirst().fqcn();
				imports.add(fqcn);
				existing.add(fqcn);
			}
		}
		return new AutoImportResult(List.copyOf(imports), "");
	}

	private String insertImports(final String source, final Analysis analysis, final List<String> imports) {
		long insertion = 0;
		if (!analysis.solution().getImports().isEmpty()) {
			final ImportTree last = analysis.solution().getImports().getLast();
			insertion = analysis.positions().getEndPosition(analysis.solution(), last);
		} else if (analysis.solution().getPackageName() != null) {
			insertion = packageSpan(source, analysis).end();
		}
		if (insertion < 0) insertion = 0;
		final String block = imports.stream().map(name -> "import " + name + ";")
				.collect(Collectors.joining("\n", insertion == 0 ? "" : "\n", "\n"));
		return source.substring(0, (int) insertion) + block + source.substring((int) insertion);
	}

	private List<Path> collectDependencies(final Analysis analysis, final LibraryIndex index) throws IOException {
		final LinkedHashSet<Path> ordered = new LinkedHashSet<>();
		final ArrayDeque<Path> queue = new ArrayDeque<>(
				referencedLibrarySources(analysis.solution(), analysis.trees(), index));
		while (!queue.isEmpty()) {
			final Path path = queue.removeFirst();
			if (!ordered.add(path)) continue;
			for (final Path dependency : libraryDependencies(path, index)) {
				if (!ordered.contains(dependency)) queue.addLast(dependency);
			}
		}
		return List.copyOf(ordered);
	}

	private Set<Path> libraryDependencies(final Path source, final LibraryIndex index) throws IOException {
		final Set<Path> cached = index.dependencies().get(source);
		if (cached != null) return cached;
		final Analysis analysis = analyze(normalize(Files.readString(source, UTF_8)), index.classPath());
		if (analysis.hasErrors()) throw new IOException("library dependency analysis failed: " + source + "\n" +
				analysis.diagnostics());
		final LinkedHashSet<Path> dependencies = new LinkedHashSet<>(
				referencedLibrarySources(analysis.solution(), analysis.trees(), index));
		dependencies.remove(source);
		final Set<Path> result = Collections.unmodifiableSet(dependencies);
		index.dependencies().put(source, result);
		return result;
	}

	private Set<Path> referencedLibrarySources(final CompilationUnitTree unit, final Trees trees,
	                                           final LibraryIndex index) {
		final LinkedHashSet<Path> result = new LinkedHashSet<>();
		new TreePathScanner<Void, Void>() {
			private void collect() {
				Element element = trees.getElement(getCurrentPath());
				TypeElement top = null;
				while (element != null && !(element instanceof PackageElement)) {
					if (element instanceof TypeElement type) top = type;
					element = element.getEnclosingElement();
				}
				if (top == null) return;
				final LibraryType type = index.byFqcn().get(top.getQualifiedName().toString());
				if (type != null) result.add(type.path());
			}
			@Override public Void visitIdentifier(final IdentifierTree node, final Void unused) {
				collect(); return super.visitIdentifier(node, unused);
			}
			@Override public Void visitMemberSelect(final MemberSelectTree node, final Void unused) {
				collect(); return super.visitMemberSelect(node, unused);
			}
			@Override public Void visitNewClass(final NewClassTree node, final Void unused) {
				collect(); return super.visitNewClass(node, unused);
			}
		}.scan(unit, null);
		return result;
	}

	private BundleOutput bundle(final String source, final Analysis analysis, final List<Path> dependencies,
	                            final Path root, final boolean debug) throws IOException {
		final LinkedHashSet<String> hoisted = new LinkedHashSet<>();
		final List<String> parts = new ArrayList<>();
		final List<String> inlined = new ArrayList<>();
		final Set<String> typeNames = analysis.solution().getTypeDecls().stream()
				.filter(ClassTree.class::isInstance).map(ClassTree.class::cast)
				.map(type -> type.getSimpleName().toString()).collect(Collectors.toCollection(HashSet::new));

		for (final Path dependency : dependencies) {
			final String code = normalize(Files.readString(dependency, UTF_8));
			final Parsed parsed = parse(code, dependency.toUri());
			for (final ImportTree importTree : parsed.unit().getImports()) {
				final String name = importTree.getQualifiedIdentifier().toString();
				if (!name.startsWith("lib.")) hoisted.add("import " + (importTree.isStatic() ? "static " : "") + name + ";");
			}
			for (final Tree declaration : parsed.unit().getTypeDecls()) {
				if (!(declaration instanceof ClassTree type)) continue;
				final String name = type.getSimpleName().toString();
				if (!typeNames.add(name)) throw new IllegalStateException("top-level type name collision: " + name);
			}
			final String fqcn = root.relativize(dependency).toString().replace(File.separatorChar, '.')
					.replaceAll("\\.java$", "");
			parts.add("// ===== inlined: " + fqcn + " =====\n" + transformLibraryUnit(code, parsed));
			inlined.add(fqcn);
		}
		hoisted.removeIf(candidate -> isCoveredBySolutionImport(candidate, analysis.solution().getImports()));

		String transformedSolution = transformSolution(source, analysis, debug, hoisted);
		if (!parts.isEmpty()) transformedSolution = transformedSolution.stripTrailing() + "\n\n" +
				String.join("\n\n", parts) + "\n";
		return new BundleOutput(transformedSolution, List.copyOf(inlined));
	}

	private String transformSolution(final String source, final Analysis analysis, final boolean debug,
	                                 final Set<String> hoisted) {
		final List<Edit> edits = new ArrayList<>();
		if (analysis.solution().getPackageName() != null) {
			final Span span = packageSpan(source, analysis);
			edits.add(new Edit(span.start(), span.end(), ""));
		}
		boolean firstLibraryImport = true;
		for (final ImportTree importTree : analysis.solution().getImports()) {
			final String name = importTree.getQualifiedIdentifier().toString();
			if (!name.startsWith("lib.")) continue;
			final Span span = treeSpan(source, analysis.solution(), importTree, analysis.positions());
			final String original = source.substring(span.start(), span.end()).stripTrailing();
			String prefix = firstLibraryImport && !hoisted.isEmpty() ? String.join("\n", hoisted) + "\n\n" : "";
			if (firstLibraryImport && prefix.isEmpty() && span.start() > 0 &&
					!source.substring(0, span.start()).endsWith("\n\n")) prefix = "\n";
			edits.add(new Edit(span.start(), span.end(), prefix + "// " + original.stripLeading() + "\n"));
			firstLibraryImport = false;
		}
		addMainAndDebugEdits(source, analysis, debug, edits);
		return LEADING_BLANK_LINES.matcher(applyEdits(source, edits)).replaceFirst("");
	}

	private boolean isCoveredBySolutionImport(final String candidate, final List<? extends ImportTree> solutionImports) {
		final boolean candidateStatic = candidate.startsWith("import static ");
		final int prefixLength = candidateStatic ? "import static ".length() : "import ".length();
		final String candidateName = candidate.substring(prefixLength, candidate.length() - 1);
		for (final ImportTree solutionImport : solutionImports) {
			if (solutionImport.isStatic() != candidateStatic) continue;
			final String solutionName = solutionImport.getQualifiedIdentifier().toString();
			if (solutionName.equals(candidateName)) return true;
			if (!solutionName.endsWith(".*")) continue;
			final int separator = candidateName.lastIndexOf('.');
			if (separator >= 0 && solutionName.substring(0, solutionName.length() - 1)
					.equals(candidateName.substring(0, separator + 1))) return true;
		}
		return false;
	}

	private void addMainAndDebugEdits(final String source, final Analysis analysis, final boolean debug,
	                                  final List<Edit> edits) {
		final MainClass main = findMainClass(analysis);
		if (main == null) return;
		final String oldName = main.tree().getSimpleName().toString();
		if (!"Main".equals(oldName)) {
			final Set<Span> spans = new LinkedHashSet<>();
			final int classStart = (int) analysis.positions().getStartPosition(analysis.solution(), main.tree());
			final int classBrace = source.indexOf('{', classStart);
			findToken(source, oldName, classStart, classBrace < 0 ? source.length() : classBrace).ifPresent(spans::add);
			for (final Tree member : main.tree().getMembers()) {
				if (member instanceof MethodTree method && method.getReturnType() == null) {
					final int start = (int) analysis.positions().getStartPosition(analysis.solution(), method);
					final int open = source.indexOf('(', start);
					findToken(source, oldName, start, open < 0 ? start : open).ifPresent(spans::add);
				}
			}
			new TreePathScanner<Void, Void>() {
				@Override public Void visitIdentifier(final IdentifierTree node, final Void unused) {
					if (analysis.trees().getElement(getCurrentPath()) == main.element()) {
						final int start = (int) analysis.positions().getStartPosition(analysis.solution(), node);
						spans.add(new Span(start, start + oldName.length()));
					}
					return super.visitIdentifier(node, unused);
				}
			}.scan(analysis.solution(), null);
			for (final Span span : spans) edits.add(new Edit(span.start(), span.end(), "Main"));
		}

		for (final Tree member : main.tree().getMembers()) {
			if (!(member instanceof VariableTree variable) || !variable.getName().contentEquals("DEBUG")) continue;
			if (!(variable.getInitializer() instanceof LiteralTree literal) || !(literal.getValue() instanceof Boolean value)) continue;
			if (value == debug) continue;
			final int start = (int) analysis.positions().getStartPosition(analysis.solution(), variable.getInitializer());
			final int end = (int) analysis.positions().getEndPosition(analysis.solution(), variable.getInitializer());
			edits.add(new Edit(start, end, Boolean.toString(debug)));
		}
	}

	private MainClass findMainClass(final Analysis analysis) {
		final MainClass[] found = {null};
		new TreePathScanner<Void, Void>() {
			@Override public Void visitClass(final ClassTree node, final Void unused) {
				if (found[0] != null) return null;
				for (final Tree member : node.getMembers()) {
					if (!(member instanceof MethodTree method) || !method.getName().contentEquals("main")) continue;
					final Set<Modifier> flags = method.getModifiers().getFlags();
					if (!flags.contains(Modifier.PUBLIC) || !flags.contains(Modifier.STATIC) || method.getParameters().size() != 1) continue;
					final Element element = analysis.trees().getElement(getCurrentPath());
					if (element instanceof TypeElement type) found[0] = new MainClass(node, type);
				}
				return found[0] == null ? super.visitClass(node, unused) : null;
			}
		}.scan(analysis.solution(), null);
		return found[0];
	}

	private String transformLibraryUnit(final String source, final Parsed parsed) {
		final List<Edit> edits = new ArrayList<>();
		if (parsed.unit().getPackageName() != null) {
			final Span span = packageSpan(source, parsed);
			edits.add(new Edit(span.start(), span.end(), ""));
		}
		for (final ImportTree importTree : parsed.unit().getImports()) {
			final Span span = treeSpan(source, parsed.unit(), importTree, parsed.positions());
			edits.add(new Edit(span.start(), span.end(), ""));
		}
		for (final Tree declaration : parsed.unit().getTypeDecls()) {
			if (!(declaration instanceof ClassTree type) || !type.getModifiers().getFlags().contains(Modifier.PUBLIC)) continue;
			final int start = (int) parsed.positions().getStartPosition(parsed.unit(), type);
			final int name = source.indexOf(type.getSimpleName().toString(), start);
			final Matcher matcher = PUBLIC_TOKEN.matcher(source).region(start, name < 0 ? start : name);
			if (matcher.find()) edits.add(new Edit(matcher.start(), matcher.end(), ""));
		}
		return applyEdits(source, edits).strip();
	}

	private Analysis analyze(final String source, final Path classPath) throws IOException {
		final DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
		final StringWriter output = new StringWriter();
		final String fileName = primaryTypeName(source) + ".java";
		final MemorySource unit = new MemorySource(fileName, source);
		final List<CompilationUnitTree> units = new ArrayList<>();
		try (StandardJavaFileManager fileManager = compiler.getStandardFileManager(diagnostics, Locale.ROOT, UTF_8)) {
			final List<String> options = new ArrayList<>(List.of("-encoding", "UTF-8", "-proc:none", "-implicit:none"));
			if (classPath != null) options.addAll(List.of("-classpath", classPath.toString()));
			final JavacTask task = (JavacTask) compiler.getTask(output, fileManager, diagnostics, options, null, List.of(unit));
			task.setTaskListener(new TaskListener() {
				@Override public void started(final TaskEvent event) {
					if (event.getKind() == TaskEvent.Kind.PARSE && event.getCompilationUnit() != null) units.add(event.getCompilationUnit());
				}
				@Override public void finished(final TaskEvent event) { }
			});
			final CompilationUnitTree solution = task.parse().iterator().next();
			task.analyze();
			if (!units.contains(solution)) units.addFirst(solution);
			final Trees trees = Trees.instance(task);
			final String text = formatDiagnostics(diagnostics, output);
			final List<CompilerDiagnostic> items = diagnosticItems(diagnostics);
			final boolean errors = diagnostics.getDiagnostics().stream().anyMatch(d -> d.getKind() == Diagnostic.Kind.ERROR);
			return new Analysis(solution, List.copyOf(units), trees, trees.getSourcePositions(), text, errors, items);
		}
	}

	private Parsed parse(final String source, final URI uri) throws IOException {
		final DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
		try (StandardJavaFileManager fileManager = compiler.getStandardFileManager(diagnostics, Locale.ROOT, UTF_8)) {
			final MemorySource unit = new MemorySource(uri, source);
			final JavacTask task = (JavacTask) compiler.getTask(null, fileManager, diagnostics,
					List.of("-proc:none"), null, List.of(unit));
			final CompilationUnitTree tree = task.parse().iterator().next();
			final Trees trees = Trees.instance(task);
			return new Parsed(tree, trees.getSourcePositions());
		}
	}

	private String primaryTypeName(final String source) {
		try {
			final Parsed parsed = parse(source, URI.create("string:///Submission.java"));
			for (final Tree declaration : parsed.unit().getTypeDecls()) {
				if (declaration instanceof ClassTree type && !type.getSimpleName().isEmpty()) return type.getSimpleName().toString();
			}
		} catch (final Exception ignored) { }
		return "Submission";
	}

	private String formatDiagnostics(final DiagnosticCollector<JavaFileObject> diagnostics, final StringWriter output) {
		final StringBuilder builder = new StringBuilder();
		for (final Diagnostic<? extends JavaFileObject> diagnostic : diagnostics.getDiagnostics()) {
			builder.append(diagnostic.getKind()).append(' ')
					.append(diagnostic.getLineNumber()).append(':').append(diagnostic.getColumnNumber()).append(' ')
					.append(diagnostic.getCode()).append(' ')
					.append(diagnostic.getMessage(Locale.ROOT)).append('\n');
		}
		if (!output.toString().isBlank()) builder.append(output);
		return builder.toString().stripTrailing();
	}

	private List<CompilerDiagnostic> diagnosticItems(final DiagnosticCollector<JavaFileObject> diagnostics) {
		return diagnostics.getDiagnostics().stream().map(diagnostic -> new CompilerDiagnostic(
				diagnostic.getKind().name(), diagnostic.getLineNumber(), diagnostic.getColumnNumber(),
				diagnostic.getCode(), diagnostic.getMessage(Locale.ROOT))).toList();
	}

	private Span packageSpan(final String source, final Analysis analysis) {
		return packageSpan(source, new Parsed(analysis.solution(), analysis.positions()));
	}

	private Span packageSpan(final String source, final Parsed parsed) {
		final int nameStart = (int) parsed.positions().getStartPosition(parsed.unit(), parsed.unit().getPackageName());
		int start = source.lastIndexOf("package", nameStart);
		if (start < 0) start = nameStart;
		int end = source.indexOf(';', nameStart);
		if (end < 0) end = (int) parsed.positions().getEndPosition(parsed.unit(), parsed.unit().getPackageName());
		else end++;
		return new Span(start, extendNewline(source, end));
	}

	private Span treeSpan(final String source, final CompilationUnitTree unit, final Tree tree,
	                     final SourcePositions positions) {
		final int start = (int) positions.getStartPosition(unit, tree);
		final int end = (int) positions.getEndPosition(unit, tree);
		return new Span(start, extendNewline(source, end));
	}

	private int extendNewline(final String source, int end) {
		if (end < source.length() && source.charAt(end) == '\r') end++;
		if (end < source.length() && source.charAt(end) == '\n') end++;
		return end;
	}

	private Optional<Span> findToken(final String source, final String token, final int from, final int to) {
		if (from < 0 || to < from) return Optional.empty();
		final Matcher matcher = Pattern.compile("\\b" + Pattern.quote(token) + "\\b").matcher(source).region(from, to);
		return matcher.find() ? Optional.of(new Span(matcher.start(), matcher.end())) : Optional.empty();
	}

	private String applyEdits(final String source, final List<Edit> edits) {
		final List<Edit> sorted = edits.stream().distinct()
				.sorted(Comparator.comparingInt(Edit::start).reversed()).toList();
		String result = source;
		int previousStart = source.length() + 1;
		for (final Edit edit : sorted) {
			if (edit.start() < 0 || edit.end() < edit.start() || edit.end() > source.length()) continue;
			if (edit.end() > previousStart) continue;
			result = result.substring(0, edit.start()) + edit.text() + result.substring(edit.end());
			previousStart = edit.start();
		}
		return result;
	}

	private String normalize(final String source) {
		return source.replace("\r\n", "\n").replace('\r', '\n');
	}

	private record LibraryType(String simpleName, String fqcn, Path path) { }
	private record LibraryIndex(Map<String, List<LibraryType>> bySimpleName, Map<String, LibraryType> byFqcn,
	                            Path classPath, Map<Path, Set<Path>> dependencies) { }
	private record AutoImportResult(List<String> imports, String error) { }
	private record BundleOutput(String source, List<String> inlined) { }
	private record Parsed(CompilationUnitTree unit, SourcePositions positions) { }
	private record Analysis(CompilationUnitTree solution, List<CompilationUnitTree> units, Trees trees,
	                        SourcePositions positions, String diagnostics, boolean hasErrors,
	                        List<CompilerDiagnostic> diagnosticItems) { }
	private record MainClass(ClassTree tree, TypeElement element) { }
	private record Span(int start, int end) { }
	private record Edit(int start, int end, String text) { }

	private static final class MemorySource extends SimpleJavaFileObject {
		private final String source;
		MemorySource(final String fileName, final String source) {
			this(URI.create("string:///" + fileName), source);
		}
		MemorySource(final URI uri, final String source) {
			super(uri, Kind.SOURCE);
			this.source = source;
		}
		@Override public CharSequence getCharContent(final boolean ignoreEncodingErrors) { return source; }
	}
}
