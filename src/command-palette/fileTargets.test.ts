import { expect, it } from "vitest";
import { assertLauncherFileSource } from "./fileTargets";

it("allows an unopened file and the existing file from the same source", () => {
  expect(() => assertLauncherFileSource([], "/project/app.ts")).not.toThrow();
  expect(() => assertLauncherFileSource([{ path: "/project/app.ts", remoteHost: null }], "/project/app.ts")).not.toThrow();
  expect(() => assertLauncherFileSource([{ path: "/project/app.ts", remoteHost: "dev" }], "/project/app.ts", "dev")).not.toThrow();
});

it("does not open a local search result against a same-path remote editor", () => {
  expect(() => assertLauncherFileSource([{ path: "/project/app.ts", remoteHost: "production" }], "/project/app.ts"))
    .toThrow("already open from SSH production");
});

it("does not reuse a local editor model or another remote host for a remote result", () => {
  expect(() => assertLauncherFileSource([{ path: "/project/app.ts" }], "/project/app.ts", "dev")).toThrow("already open from this computer");
  expect(() => assertLauncherFileSource([{ path: "/project/app.ts", remoteHost: "production" }], "/project/app.ts", "dev")).toThrow("already open from SSH production");
});
