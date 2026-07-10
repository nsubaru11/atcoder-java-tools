import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {BundleError, bundleJavaSource, hasLibImports} from "./java-bundle";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atcoder-java-bundle-"));

try {
	const ds = path.join(root, "lib", "ds");
	const graph = path.join(root, "lib", "graph");
	fs.mkdirSync(ds, {recursive: true});
	fs.mkdirSync(graph, {recursive: true});

	fs.writeFileSync(path.join(ds, "UnionFind.java"), `package lib.ds;

import java.util.Arrays;

public final class UnionFind {
	private final int[] root;
	public UnionFind(int n) { root = new int[n]; Arrays.setAll(root, i -> i); }
}
`);
	fs.writeFileSync(path.join(ds, "UnusedTree.java"), `package lib.ds;

public final class UnusedTree {}
`);
	fs.writeFileSync(path.join(graph, "Kruskal.java"), `package lib.graph;

import lib.ds.UnionFind;

public final class Kruskal {
	private final UnionFind uf;
	public Kruskal(int n) { uf = new UnionFind(n); }
}
`);

	const source = `import lib.graph.Kruskal;

public class Main {
	public static void main(String[] args) { new Kruskal(3); }
}
`;
	const result = bundleJavaSource(source, {libSrcRoot: root});
	assert.deepEqual(result.inlined, ["lib.graph.Kruskal", "lib.ds.UnionFind"]);
	assert.match(result.bundled, /import java\.util\.Arrays;/);
	assert.match(result.bundled, /\/\/ import lib\.graph\.Kruskal;/);
	assert.doesNotMatch(result.bundled, /^\s*import\s+lib\./m);
	assert.doesNotMatch(result.bundled, /\bpackage\s+lib\./);

	const wildcard = bundleJavaSource(`import lib.ds.*;
class Main { UnionFind uf = new UnionFind(3); }
`, {libSrcRoot: root});
	assert.deepEqual(wildcard.inlined, ["lib.ds.UnionFind"]);
	assert.match(wildcard.bundled, /\/\/ import lib\.ds\.\*;/);
	assert.doesNotMatch(wildcard.bundled, /UnusedTree/);
	assert.equal(hasLibImports("// import lib.ds.UnionFind;\nclass Main {}"), false);
	assert.equal(hasLibImports("import patterns.dp.Frog;\nclass Main {}"), false);
	assert.throws(
		() => bundleJavaSource("import static lib.ds.UnionFind.*; class Main {}", {libSrcRoot: root}),
		BundleError,
	);
	console.log("java-bundle smoke test: OK");
} finally {
	fs.rmSync(root, {recursive: true, force: true});
}
