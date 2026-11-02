import { describe, expect, it, vi } from "vitest";
import { requireAdminRole } from "./admin-access";

describe("administrator access", () => {
  it("checks the designated account against its stored admin role", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(requireAdminRole({ rpc }, "7b3eee07-9b66-4087-a0d2-838be3cb4ed0")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("has_role", { _user_id: "7b3eee07-9b66-4087-a0d2-838be3cb4ed0", _role: "admin" });
  });
  it("rejects a normal account", async () => {
    await expect(requireAdminRole({ rpc: vi.fn().mockResolvedValue({ data: false, error: null }) }, "ordinary-user")).rejects.toThrow("غير مصرح");
  });
  it("rejects a failed role lookup even with a truthy result", async () => {
    await expect(requireAdminRole({ rpc: vi.fn().mockResolvedValue({ data: true, error: new Error("offline") }) }, "ordinary-user")).rejects.toThrow("غير مصرح");
  });
});