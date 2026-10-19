// Netlify Function — ฐานข้อมูลกลาง เก็บเป็นไฟล์ JSON ใน GitHub (private repo)
//   GET  /api/data  -> { data, sha }            (รองรับ x-db-etag -> 304)
//   PUT  /api/data  -> { sha } | 409 {data,sha} (optimistic locking ด้วย sha ของไฟล์)
// ตัวแปรที่ต้องตั้งใน Netlify: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, ACCESS_CODE
// (ไม่บังคับ) GITHUB_BRANCH=main, GITHUB_PATH=data/db.json
import { createHash, timingSafeEqual } from "node:crypto";

const GH = "https://api.github.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const digest = (s) => createHash("sha256").update(String(s)).digest();
const safeEqual = (a, b) => timingSafeEqual(digest(a), digest(b));

class HttpErr extends Error {
  constructor(code, status = 500, message = "") {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = message;
  }
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });

function readConfig() {
  const e = process.env;
  const t = (v) => (v || "").trim(); // กันช่องว่าง/ขึ้นบรรทัดใหม่ที่ติดมาตอนวางค่า
  let owner = t(e.GITHUB_OWNER);
  let repo = t(e.GITHUB_REPO);
  if (repo.includes("/")) { // เผื่อใส่ "owner/repo" ในช่อง GITHUB_REPO
    const [o, r] = repo.split("/");
    owner = owner || o;
    repo = r;
  }
  repo = repo.replace(/\.git$/, "");
  const c = {
    token: t(e.GITHUB_TOKEN),
    owner,
    repo,
    branch: t(e.GITHUB_BRANCH) || "main",
    path: t(e.GITHUB_PATH) || "data/db.json",
    code: t(e.ACCESS_CODE || e.APP_PASSCODE),
  };
  c.ok = Boolean(c.token && c.owner && c.repo && c.code);
  return c;
}

export default async (req) => {
  const c = readConfig();
  if (!c.ok) return json({ error: "server_not_configured" }, 500);

  const given = req.headers.get("x-access-code") || "";
  if (!safeEqual(given, c.code)) {
    await sleep(700); // หน่วงเล็กน้อยลดการเดารหัส
    return json({ error: "unauthorized" }, 401);
  }

  const headers = (extra = {}) => ({
    Authorization: `Bearer ${c.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "equipment-loan-netlify",
    ...extra,
  });
  const fileUrl = `${GH}/repos/${c.owner}/${c.repo}/contents/${c.path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const refQs = `?ref=${encodeURIComponent(c.branch)}`;

  async function read(etag) {
    const r = await fetch(fileUrl + refQs, {
      headers: headers(etag ? { "If-None-Match": etag } : {}),
    });
    if (r.status === 304) return { notModified: true };
    if (r.status === 404) {
      // 404 อาจแปลว่า repo/โทเคนผิด ไม่ใช่แค่ยังไม่มีไฟล์ — เช็คก่อน
      const repo = await fetch(`${GH}/repos/${c.owner}/${c.repo}`, { headers: headers() });
      if (!repo.ok) throw new HttpErr("repo_not_accessible", 500, `GitHub ${repo.status}`);
      return { data: null, sha: null, etag: r.headers.get("etag") };
    }
    if (!r.ok) throw new HttpErr("github_error", 502, `GitHub ${r.status}`);
    const j = await r.json();
    let text;
    if (j.encoding === "base64" && j.content) {
      text = Buffer.from(j.content, "base64").toString("utf8");
    } else if (j.size === 0) {
      text = "";
    } else {
      // ไฟล์ใหญ่กว่า 1 MB: contents API ไม่ส่ง content มา ต้องขอแบบ raw
      const raw = await fetch(fileUrl + refQs, {
        headers: headers({ Accept: "application/vnd.github.raw+json" }),
      });
      if (!raw.ok) throw new HttpErr("github_error", 502, `GitHub ${raw.status}`);
      text = await raw.text();
    }
    let data = null;
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new HttpErr("db_corrupt", 500);
      }
    }
    return { data, sha: j.sha, etag: r.headers.get("etag") };
  }

  try {
    if (req.method === "GET") {
      const cur = await read(req.headers.get("x-db-etag") || undefined);
      if (cur.notModified) return new Response(null, { status: 304, headers: { "cache-control": "no-store" } });
      return json({ data: cur.data, sha: cur.sha }, 200, { "x-db-etag": cur.etag || "" });
    }

    if (req.method === "PUT") {
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: "bad_json" }, 400);
      }
      const d = body && body.data;
      if (!d || !Array.isArray(d.eqs) || !Array.isArray(d.recs) || typeof d.stk !== "object" || d.stk === null) {
        return json({ error: "bad_data" }, 400);
      }
      const text = JSON.stringify(d, null, 1); // เว้นวรรค 1 ช่อง ให้ diff ใน GitHub อ่านง่าย
      if (text.length > 8_000_000) return json({ error: "too_large" }, 413);

      const payload = {
        message: `update: ${d.recs.length} records, ${d.eqs.length} equipment`,
        content: Buffer.from(text, "utf8").toString("base64"),
        branch: c.branch,
      };
      if (body.sha) payload.sha = body.sha;

      const r = await fetch(fileUrl, {
        method: "PUT",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      if (r.status === 409 || r.status === 422) {
        const cur = await read();
        if (cur.sha !== (body.sha || null)) {
          return json({ error: "conflict", data: cur.data, sha: cur.sha }, 409);
        }
        const m = await r.json().catch(() => ({}));
        return json({ error: "github_error", message: m.message || `GitHub ${r.status}` }, 502);
      }
      if (!r.ok) {
        const m = await r.json().catch(() => ({}));
        return json({ error: "github_error", message: m.message || `GitHub ${r.status}` }, 502);
      }
      const j = await r.json();
      return json({ sha: j.content.sha });
    }

    return json({ error: "method_not_allowed" }, 405, { allow: "GET, PUT" });
  } catch (e) {
    if (e instanceof HttpErr) return json({ error: e.code, message: e.detail }, e.status);
    return json({ error: "upstream_error" }, 502);
  }
};

export const config = { path: "/api/data" };
