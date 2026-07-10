import java.nio.file.*;

sealed interface Request {
}

record Ping() implements Request {
}

record Run(String requestId, Path classDirectory, String mainClassName, byte[] standardInput)
		implements Request {
}

record Compile(String requestId, Path sourceFile, Path outputDirectory)
		implements Request {
}

record Transform(String requestId, String sourceCode, Path librarySourceRoot, boolean debug, boolean autoImport)
		implements Request {
}
