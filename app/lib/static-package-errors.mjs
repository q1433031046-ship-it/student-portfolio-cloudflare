export class PackageMediaError extends Error {
  constructor(issues) { super('部分媒体无法导出，请核对以下项目'); this.issues = issues; this.code = 'MEDIA_INVALID'; }
}
export function safeMediaLabel(value, index) {
  return typeof value === 'string' && /^[\p{L}\p{N} _·（）().-]{1,64}$/u.test(value) ? value : `媒体 ${index + 1}`;
}
export const packageStatusMessages = {
  401: '管理员会话已失效，请重新登录', 403: '当前会话没有静态导出权限',
  428: '请先完成管理员初始化或升级恢复确认', 409: '草稿版本已变化，请刷新已保存版本后重新下载',
  422: '媒体不满足导出条件，请查看诊断', 404: '静态导出接口或媒体不存在，请核对程序版本',
};
export function packageResponseMessage(status, body, revision, phase = 'description') {
  const message = packageStatusMessages[status] ?? (status >= 500 ? '服务暂不可用，请保留诊断并稍后重试' : '静态导出请求失败');
  const code = typeof body?.code === 'string' && /^[A-Z_0-9]{1,48}$/.test(body.code) ? body.code : `HTTP_${status}`;
  const stage = typeof body?.phase === 'string' && /^[a-z-]{1,32}$/.test(body.phase) ? body.phase : phase;
  const issues = status === 422 && Array.isArray(body?.issues) ? body.issues.slice(0, 200).map((issue, i) => {
    const size = Number.isSafeInteger(issue.bytes) && issue.bytes >= 0 ? issue.bytes : '未知';
    const limit = Number.isSafeInteger(issue.limit) && issue.limit > 0 ? issue.limit : '未知';
    const reason = ['MISSING', 'NOT_READY', 'SIZE', 'TYPE', 'PATH', 'CONFLICT'].includes(issue.reason) ? issue.reason : 'INVALID';
    return `${safeMediaLabel(issue.label, i)}：${size} bytes，限制 ${limit} bytes，${reason}`;
  }) : [];
  return [message, ...issues, `phase=${stage}; code=${code}; HTTP=${status}; revision=${Number.isSafeInteger(revision) ? revision : 'unknown'}`].join('\n');
}
