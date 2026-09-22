import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
const model = (id: string) => ({ id, label: id, description: "Cached" });
beforeEach(() => vi.resetModules());

it("refreshes the local model cache on demand and filters retired subscription models", async () => {
  vi.mocked(invoke).mockResolvedValueOnce([model("gpt-5.4-mini"), model("gpt-5.5")]).mockResolvedValueOnce([model("gpt-5.6-luna")]);
  const { codexCliModels } = await import("./codexCli");
  expect(await codexCliModels()).toEqual([model("gpt-5.5")]);
  expect(await codexCliModels()).toEqual([model("gpt-5.5")]);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(await codexCliModels(true)).toEqual([model("gpt-5.6-luna")]);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("can refresh after the CLI previously had no readable cache", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("No cache")).mockResolvedValueOnce([model("gpt-5.6-luna")]);
  const { codexCliModels } = await import("./codexCli");
  expect(await codexCliModels()).toEqual([]);
  expect(await codexCliModels(true)).toEqual([model("gpt-5.6-luna")]);
});
