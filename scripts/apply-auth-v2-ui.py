from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    if old not in content:
        raise RuntimeError(f"missing replacement in {path}: {old[:140]!r}")
    write(path, content.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    content = read(path)
    updated, count = re.subn(pattern, lambda _match: replacement, content, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"expected one regex replacement in {path}, found {count}: {pattern[:140]!r}")
    write(path, updated)


schema = "db/schema.ts"
replace_once(
    schema,
    '  recoverySalt: text("recovery_salt").notNull(),\n  failedAttempts: integer("failed_attempts").notNull().default(0),',
    '  recoverySalt: text("recovery_salt").notNull(),\n  authScheme: text("auth_scheme", { enum: ["v1", "v2"] }).notNull().default("v1"),\n  securityVersion: text("security_version").notNull().default("legacy"),\n  failedAttempts: integer("failed_attempts").notNull().default(0),',
)

admin = "app/admin/admin-client.tsx"
replace_once(
    admin,
    'import { rememberLocalMediaPreview, useMediaPreview } from "./media-preview-cache";',
    'import { rememberLocalMediaPreview, useMediaPreview } from "./media-preview-cache";\nimport { FIXED_INITIAL_ADMIN_CODE } from "../program-version";',
)
replace_once(
    admin,
    '''type SetupPayload = {
  state: "initial_setup" | "ready";
  identity: string | null;
};''',
    '''type SetupPayload = {
  state: "initial_setup" | "password_reset_required" | "ready";
  identity: string | null;
  currentVersion?: string;
};''',
)
replace_once(
    admin,
    'const [state, setState] = useState<"loading" | "initial_setup" | "recovery_code" | "ready" | "unauthenticated" | "recover" | "error">("loading");',
    'const [state, setState] = useState<"loading" | "initial_setup" | "upgrade_reset" | "recovery_code" | "ready" | "unauthenticated" | "recover" | "error">("loading");',
)
replace_once(admin, 'const [initialCode, setInitialCode] = useState("");', 'const [initialCode, setInitialCode] = useState(FIXED_INITIAL_ADMIN_CODE);')
replace_once(
    admin,
    '  const [issuedRecoveryCode, setIssuedRecoveryCode] = useState<string | null>(null);',
    '  const [issuedRecoveryCode, setIssuedRecoveryCode] = useState<string | null>(null);\n  const [showPassword, setShowPassword] = useState(false);\n  const [capsLockOn, setCapsLockOn] = useState(false);',
)
replace_once(
    admin,
    '''      if (setupBody.state === "initial_setup") {
        setState("initial_setup");
        setMessage("使用部署时填写的一次性口令初始化管理员");
        return;
      }

      const [response, accessResponse, storageResponse] = await Promise.all([''',
    '''      if (setupBody.state === "initial_setup") {
        setInitialCode(FIXED_INITIAL_ADMIN_CODE);
        setState("initial_setup");
        setMessage("使用统一的一次性口令创建管理员");
        return;
      }
      if (setupBody.state === "password_reset_required") {
        setState("upgrade_reset");
        setMessage(`程序已升级到 v${setupBody.currentVersion ?? "最新版本"}，请使用最新恢复码重置一次密码`);
        return;
      }

      const [response, accessResponse, storageResponse] = await Promise.all([''',
)

regex_once(
    admin,
    r'  async function completeSetup\(\) \{.*?\n  \}\n\n  async function login',
    '''  async function completeSetup() {
    if (setupBusy) return;
    if (password !== passwordAgain) {
      notify("两次输入的密码不一致");
      return;
    }
    setSetupBusy(true);
    setMessage("正在验证一次性口令并创建管理员…");
    try {
      const result = await api<{ state: string; recoveryCode: string }>("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialCode, password }),
        timeoutMs: 20_000,
      });
      setIssuedRecoveryCode(result.recoveryCode);
      setInitialCode(FIXED_INITIAL_ADMIN_CODE);
      setPassword("");
      setPasswordAgain("");
      setState("recovery_code");
      setMessage("管理员已创建，请立即保存最新系统恢复码");
    } catch (error) {
      if (error instanceof ApiError && error.code === "ADMIN_ALREADY_INITIALIZED") {
        setState("unauthenticated");
        setMessage("管理员已经创建，请使用刚才设置的密码登录");
      } else if (error instanceof ApiError && error.code === "REQUEST_TIMEOUT") {
        setMessage("响应等待较久，正在确认管理员是否已经创建…");
        await wait(500);
        await load();
      } else {
        setState("initial_setup");
        notify(errorMessage(error));
      }
    } finally {
      setSetupBusy(false);
    }
  }

  async function login''',
)
regex_once(
    admin,
    r'  async function login\(\) \{.*?\n  \}\n\n  async function recoverPassword',
    '''  async function login() {
    if (setupBusy) return;
    setSetupBusy(true);
    setMessage("正在验证管理员密码…");
    try {
      await api<{ ok: boolean }>("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        timeoutMs: 20_000,
      });
      setPassword("");
      setMessage("密码正确，正在确认登录状态…");
      if (!await confirmAdminSession()) {
        throw new ApiError("密码已经验证，但登录状态尚未建立，请重新点击进入后台", 503, "SESSION_CONFIRMATION_FAILED");
      }
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.code === "PASSWORD_RESET_REQUIRED") {
        setPassword("");
        setState("upgrade_reset");
        setMessage("程序升级后需要使用最新恢复码重置一次密码");
      } else {
        setState("unauthenticated");
        notify(errorMessage(error));
      }
    } finally {
      setSetupBusy(false);
    }
  }

  async function recoverPassword''',
)
regex_once(
    admin,
    r'  async function recoverPassword\(\) \{.*?\n  \}\n\n  async function logout',
    '''  async function recoverPassword() {
    if (setupBusy) return;
    if (password !== passwordAgain) {
      notify("两次输入的新密码不一致");
      return;
    }
    const returnState = state === "upgrade_reset" ? "upgrade_reset" : "recover";
    setSetupBusy(true);
    setMessage(returnState === "upgrade_reset" ? "正在完成本次升级安全确认…" : "正在校验恢复码并重置密码…");
    try {
      const result = await api<{ ok: boolean; recoveryCode: string }>("/api/admin/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryCode: recoveryInput, password }),
        timeoutMs: 25_000,
      });
      setIssuedRecoveryCode(result.recoveryCode);
      setRecoveryInput("");
      setPassword("");
      setPasswordAgain("");
      setState("recovery_code");
      setMessage("密码已更新；旧恢复码已经失效，请保存新恢复码");
    } catch (error) {
      setState(returnState);
      notify(errorMessage(error));
    } finally {
      setSetupBusy(false);
    }
  }

  async function logout''',
)
replace_once(
    admin,
    '`网站管理员系统恢复码\\n\\n${issuedRecoveryCode}\\n\\n此恢复码只能使用一次。使用后系统会生成新恢复码。\\n`,',
    '`网站管理员最新系统恢复码\\n\\n${issuedRecoveryCode}\\n\\n重要：旧恢复码已经失效。此恢复码用于忘记密码和下一次正式版本升级；使用后系统会再生成一份新恢复码。\\n`,',
)

regex_once(
    admin,
    r'  if \(state === "initial_setup"\) \{.*?\n  \}\n  if \(state === "recover"\) return \(',
    '''  if (state === "initial_setup") {
    return (
      <StatePanel
        label="FIRST SETUP"
        title="创建网站管理员"
        detail="统一口令已经填写。设置自己的管理员密码后，系统会生成第一份恢复码。"
      >
        <form className={styles.authForm} onSubmit={(event) => { event.preventDefault(); void completeSetup(); }}>
          <label><span>统一一次性部署口令</span><input type="text" autoComplete="off" spellCheck={false} value={initialCode} readOnly /><small>固定为 {FIXED_INITIAL_ADMIN_CODE}，只用于第一次创建管理员</small></label>
          <label><span>管理员密码</span><input type={showPassword ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="new-password" value={password} onKeyUp={(event) => setCapsLockOn(event.getModifierState("CapsLock"))} onChange={(event) => setPassword(event.target.value)} /><small>10至128位，至少包含文字和数字；首尾不要留空格</small></label>
          <label><span>再次输入密码</span><input type={showPassword ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="new-password" value={passwordAgain} onKeyUp={(event) => setCapsLockOn(event.getModifierState("CapsLock"))} onChange={(event) => setPasswordAgain(event.target.value)} />{passwordAgain && password !== passwordAgain && <small>两次密码还不一致</small>}</label>
          {capsLockOn && <p role="status">大写锁定已开启，请确认大小写。</p>}
          <button className={styles.textAction} type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? "隐藏密码" : "显示密码"}</button>
          <button className={styles.primaryAction} type="submit" disabled={setupBusy}>{setupBusy ? "正在创建并确认…" : "创建管理员 →"}</button>
        </form>
      </StatePanel>
    );
  }
  if (state === "upgrade_reset") return (
    <StatePanel label="SECURITY UPDATE" title="完成本次版本升级" detail="输入你保存的最新系统恢复码，设置一次新密码。完成后旧恢复码作废，系统会生成新的恢复码。">
      <form className={styles.authForm} onSubmit={(event) => { event.preventDefault(); void recoverPassword(); }}>
        <label><span>最新系统恢复码</span><input type="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value)} /><small>只使用最后一次保存的恢复码</small></label>
        <label><span>新管理员密码</span><input type={showPassword ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="new-password" value={password} onKeyUp={(event) => setCapsLockOn(event.getModifierState("CapsLock"))} onChange={(event) => setPassword(event.target.value)} /></label>
        <label><span>再次输入新密码</span><input type={showPassword ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="new-password" value={passwordAgain} onKeyUp={(event) => setCapsLockOn(event.getModifierState("CapsLock"))} onChange={(event) => setPasswordAgain(event.target.value)} />{passwordAgain && password !== passwordAgain && <small>两次密码还不一致</small>}</label>
        {capsLockOn && <p role="status">大写锁定已开启，请确认大小写。</p>}
        <button className={styles.textAction} type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? "隐藏密码" : "显示密码"}</button>
        <button className={styles.primaryAction} type="submit" disabled={setupBusy}>{setupBusy ? "正在更新密码…" : "完成升级并生成新恢复码 →"}</button>
      </form>
    </StatePanel>
  );
  if (state === "recover") return (''',
)
replace_once(
    admin,
    '''        <label><span>系统恢复码</span><input type="text" autoCapitalize="characters" autoComplete="off" value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value)} /></label>
        <label><span>新管理员密码</span><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label><span>再次输入新密码</span><input type="password" autoComplete="new-password" value={passwordAgain} onChange={(event) => setPasswordAgain(event.target.value)} /></label>
        <button className={styles.primaryAction} type="submit" disabled={setupBusy}>{setupBusy ? "正在重置…" : "重置密码 →"}</button>''',
    '''        <label><span>最新系统恢复码</span><input type="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value)} /></label>
        <label><span>新管理员密码</span><input type={showPassword ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="new-password" value={password} onKeyUp={(event) => setCapsLockOn(event.getModifierState("CapsLock"))} onChange={(event) => setPassword(event.target.value)} /></label>
        <label><span>再次输入新密码</span><input type={showPassword ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="new-password" value={passwordAgain} onKeyUp={(event) => setCapsLockOn(event.getModifierState("CapsLock"))} onChange={(event) => setPasswordAgain(event.target.value)} />{passwordAgain && password !== passwordAgain && <small>两次密码还不一致</small>}</label>
        {capsLockOn && <p role="status">大写锁定已开启，请确认大小写。</p>}
        <button className={styles.textAction} type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? "隐藏密码" : "显示密码"}</button>
        <button className={styles.primaryAction} type="submit" disabled={setupBusy}>{setupBusy ? "正在重置…" : "重置密码并生成新恢复码 →"}</button>''',
)
replace_once(
    admin,
    'detail="系统以后不会再次显示这份恢复码。密码和恢复码同时丢失时，网站无法自行找回。"',
    'detail="这是当前唯一有效的最新恢复码。旧恢复码已经作废；下次忘记密码或正式版本升级时需要使用这一份。"',
)
replace_once(
    admin,
    '<small>一次性使用 · 请离线保存</small>',
    '<small>最新一份 · 使用后会换新 · 请立即离线保存</small>',
)

regex_once(
    admin,
    r'async function api<T>\(input: string, init\?: RequestInit\): Promise<T> \{.*?\}\s*$',
    '''type ApiRequestInit = RequestInit & { timeoutMs?: number };

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "API_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function confirmAdminSession() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("/api/admin/setup", { credentials: "same-origin", cache: "no-store" });
    if (response.ok) {
      const body = await response.json().catch(() => ({})) as { state?: string };
      if (body.state === "ready") return true;
    }
    await wait(250 * (attempt + 1));
  }
  return false;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function api<T>(input: string, init?: ApiRequestInit): Promise<T> {
  const { timeoutMs, ...requestInit } = init ?? {};
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(input, {
      ...requestInit,
      signal: requestInit.signal ?? controller?.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({})) as T & { error?: string; details?: string[]; code?: string };
    if (!response.ok) throw new ApiError(body.details?.[0] || body.error || `请求失败（${response.status}）`, response.status, body.code);
    return body;
  } catch (error) {
    if (controller?.signal.aborted) throw new ApiError("服务器响应超过等待时间，系统将检查操作是否已经完成", 408, "REQUEST_TIMEOUT");
    throw error;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
}
''',
)

print("authentication v2 UI patch applied")
