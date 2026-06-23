/**
 * 要求を対応するサービスへ振り分け、{@link Response} を返す薄いルーターです。
 * <p>
 * コンパイルは {@link JavaCompilerService}、実行は {@link ProgramRunner} に委譲します。
 * 文字列・Base64・タブといったワイヤ形式は扱いません。
 * </p>
 */
final class Executor {
	private final JavaCompilerService compilerService = new JavaCompilerService();
	private final ProgramRunner programRunner = new ProgramRunner();

	/**
	 * 要求種別ごとに処理を振り分けます（Ping/Compile/Run を網羅）。
	 *
	 * @param request 受理済みの要求
	 * @return 応答
	 */
	Response handle(final Request request) {
		return switch (request) {
			case Ping ignored -> new Pong();
			case Compile compile -> onCompile(compile);
			case Run run -> onRun(run);
		};
	}

	private Response onCompile(final Compile request) {
		try {
			return new Compiled(request.requestId(), compilerService.compile(request.sourceFile(), request.outputDirectory()));
		} catch (final Throwable throwable) {
			return new ErrorResponse(request.requestId(), throwable.toString());
		}
	}

	private Response onRun(final Run request) {
		try {
			return new Result(request.requestId(), programRunner.run(request.classDirectory(), request.mainClassName(), request.standardInput()));
		} catch (final Throwable throwable) {
			return new ErrorResponse(request.requestId(), throwable.toString());
		}
	}
}
