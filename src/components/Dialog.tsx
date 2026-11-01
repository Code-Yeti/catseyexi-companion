import { useEffect, useRef, useState } from "react";

// In-app replacements for confirm/prompt/alert, styled like the app. <DialogHost/> is mounted once in App;
// ask() resolves with the clicked button and the input's text, or null on Cancel / Esc.
type Req = { text: string; input?: string; buttons: string[]; done: (r: { button: string; value: string } | null) => void };
let show: ((r: Req) => void) | undefined;

export const ask = (text: string, buttons: string[], input?: string) =>
  new Promise<{ button: string; value: string } | null>((done) => show?.({ text, buttons, input, done }));
export const confirmBox = async (text: string, ok = "OK") => (await ask(text, [ok])) !== null;
export const promptBox = async (text: string, initial = "") => (await ask(text, ["OK"], initial))?.value.trim() || null;
export const alertBox = async (text: string) => { await ask(text, []); };

export function DialogHost() {
  const [req, setReq] = useState<Req>();
  const [value, setValue] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { show = (r) => { setReq(r); setValue(r.input ?? ""); }; }, []);
  useEffect(() => { if (req) ref.current?.showModal(); }, [req]);

  const close = (button: string | null) => {
    ref.current?.close();
    req?.done(button === null ? null : { button, value });
    setReq(undefined);
  };
  if (!req) return null;
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); close(null); }}>
      <div style={{ whiteSpace: "pre-line" }}>{req.text}</div>
      {req.input !== undefined && (
        <input autoFocus style={{ width: "100%", marginTop: 10 }} value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && close(req.buttons[0])} />
      )}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        {req.buttons.map((b, i) => <button key={b} autoFocus={i === 0 && req.input === undefined} className={i === 0 ? "active-tab" : ""} onClick={() => close(b)}>{b}</button>)}
        <button onClick={() => close(req.buttons.length ? null : "OK")}>{req.buttons.length ? "Cancel" : "OK"}</button>
      </div>
    </dialog>
  );
}
