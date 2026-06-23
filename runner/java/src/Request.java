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
