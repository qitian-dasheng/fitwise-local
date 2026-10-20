import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ArtifactPrivacyModal, ArtifactThumbnail, ImportInputModal, ExportArtifactButton } from "../src/components/InputArtifacts";
import { save } from "@tauri-apps/plugin-dialog";
import type { InputReceipt } from "../src/data/artifacts";
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/plugin-dialog",()=>({save:vi.fn()}));
let host:HTMLDivElement;let root:Root;const close=vi.fn();
const item:InputReceipt={id:"intake-001",artifactId:"hash",name:"test.png",note:"电话 13800138000",mime:"image/png",createdAt:"2026-10-20T12:00:00Z",source:"desktop",status:"unreviewed",width:64,height:40,trashedAt:null,purgedAt:null,privacyHash:null,bytes:100};
beforeEach(()=>{(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;(window as unknown as Record<string,unknown>).__TAURI_INTERNALS__={};host=document.createElement("div");document.body.append(host);root=createRoot(host);vi.mocked(invoke).mockReset();close.mockReset();URL.createObjectURL=vi.fn(()=>"blob:local-preview");URL.revokeObjectURL=vi.fn();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete (window as unknown as Record<string,unknown>).__TAURI_INTERNALS__;});
it("preserves intake input and request ID on storage failure, without confirming business records",async()=>{
  vi.mocked(invoke).mockRejectedValueOnce("模拟磁盘失败").mockResolvedValue({});await act(async()=>root.render(<ImportInputModal onClose={close}/>));
  const field=host.querySelector("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,"今天买的酸奶");field.dispatchEvent(new Event("input",{bubbles:true}));});
  const submit=()=>act(async()=>{host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});await submit();expect(host.textContent).toContain("模拟磁盘失败");expect(field.value).toBe("今天买的酸奶");expect(close).not.toHaveBeenCalled();await submit();
  const calls=vi.mocked(invoke).mock.calls;expect(calls[0][0]).toBe("import_local_input");expect((calls[0][1] as {requestId:string}).requestId).toBe((calls[1][1] as {requestId:string}).requestId);expect(close).toHaveBeenCalledOnce();expect(calls.every(c=>c[0]==="import_local_input")).toBe(true);
});
it("list thumbnails never request original previews and release their object URLs",async()=>{
  vi.mocked(invoke).mockResolvedValue([1,2,3]);await act(async()=>root.render(<ArtifactThumbnail item={item}/>));
  expect(invoke).toHaveBeenCalledWith("read_artifact_preview",{id:"hash",kind:"thumbnail"});expect(host.querySelector("img")?.src).toBe("blob:local-preview");
  await act(async()=>root.render(<div/>));expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-preview");
});
it("privacy preview requires explicit confirmation and only marks a local draft",async()=>{
  vi.mocked(invoke).mockResolvedValue([1,2,3]);await act(async()=>root.render(<ArtifactPrivacyModal item={item} onClose={close}/>));
  const draft=[...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.includes("标记本地待识别"))!;expect(draft.disabled).toBe(true);expect(host.querySelector(".redacted-preview")?.textContent).not.toContain("13800138000");
  await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());await act(async()=>draft.click());expect(invoke).toHaveBeenCalledWith("set_input_status",{id:"intake-001",status:"drafted"});expect(vi.mocked(invoke).mock.calls.every(c=>["read_artifact_preview","set_input_status"].includes(c[0]))).toBe(true);
});
it("a deleted original is clearly labelled and not loaded as an image",async()=>{
  await act(async()=>root.render(<ArtifactPrivacyModal item={{...item,purgedAt:"2026-10-20T12:00:00Z"}} onClose={close}/>));expect(host.textContent).toContain("原件已删除");expect(invoke).not.toHaveBeenCalled();expect(host.querySelector(".mask-canvas")).toBeNull();
});
it("exports only the explicitly selected original and warns that it is unredacted",async()=>{
  vi.mocked(save).mockResolvedValue("C:\\exports\\new.png");vi.mocked(invoke).mockResolvedValue(undefined);
  await act(async()=>root.render(<ExportArtifactButton item={item}/>));
  await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
  expect(invoke).toHaveBeenCalledExactlyOnceWith("export_artifact_original",{id:"hash",outputPath:"C:\\exports\\new.png"});
  expect(host.textContent).toContain("未遮挡、未加密");expect(close).not.toHaveBeenCalled();
});
it("cancelling original export performs no write and trashed originals cannot export",async()=>{
  vi.mocked(save).mockResolvedValue(null);
  await act(async()=>root.render(<ExportArtifactButton item={item}/>));
  await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());expect(invoke).not.toHaveBeenCalled();
  await act(async()=>root.render(<ExportArtifactButton item={{...item,trashedAt:"2026-10-20"}}/>));
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
});
