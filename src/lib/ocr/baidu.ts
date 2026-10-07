const TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token";
const TASK_URL = "https://aip.baidubce.com/rest/2.0/brain/online/v2/unlimited-ocr-parser/task";
const QUERY_URL = "https://aip.baidubce.com/rest/2.0/brain/online/v2/unlimited-ocr-parser/task/query";

let cachedToken: { token: string; expiresAt: number } | null = null;

export function isBaiduOcrConfigured(): boolean {
  return Boolean(process.env.BAIDU_API_KEY && process.env.BAIDU_SECRET_KEY);
}

async function getAccessToken(): Promise<string> {
  const apiKey = process.env.BAIDU_API_KEY;
  const secretKey = process.env.BAIDU_SECRET_KEY;
  if (!apiKey || !secretKey) throw new Error("Baidu OCR is not configured. Set BAIDU_API_KEY and BAIDU_SECRET_KEY.");

  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: apiKey,
    client_secret: secretKey,
  });
  const response = await fetch(`${TOKEN_URL}?${params.toString()}`, { method: "POST" });
  const data: any = await response.json().catch(() => ({}));
  if (!data.access_token) throw new Error(`Baidu OCR token failed: ${data.error_description || data.error || response.status}`);
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 2592000) - 300) * 1000 };
  return data.access_token;
}

async function postForm(url: string, fields: URLSearchParams): Promise<any> {
  const token = await getAccessToken();
  const response = await fetch(`${url}?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: fields.toString(),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (data.error_code) throw new Error(`Baidu OCR error ${data.error_code}: ${data.error_msg}`);
  return data;
}

function stripMarkdownTables(markdown: string): string {
  return markdown.replace(/<table[\s\S]*?<\/table>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n");
}

export async function extractWithBaiduOcr(
  file: Buffer,
  options: { filename?: string; timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 120000;
  const pollEveryMs = 5000;

  const submitted = await postForm(
    TASK_URL,
    new URLSearchParams({ file_data: file.toString("base64"), file_name: options.filename || "document.pdf" }),
  );
  const taskId: string | undefined = submitted.result?.task_id;
  if (!taskId) throw new Error("Baidu OCR did not return a task_id.");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollEveryMs));
    const result = await postForm(QUERY_URL, new URLSearchParams({ task_id: taskId }));
    const status = result.result?.status;
    if (status === "success") {
      const markdownUrl: string | undefined = result.result?.markdown_url;
      if (!markdownUrl) throw new Error("Baidu OCR succeeded but returned no markdown_url.");
      const mdResponse = await fetch(markdownUrl);
      if (!mdResponse.ok) throw new Error(`Baidu OCR markdown download failed: ${mdResponse.status}`);
      const markdown = await mdResponse.text();
      return stripMarkdownTables(markdown).trim();
    }
    if (status === "failed") {
      throw new Error(`Baidu OCR task failed: ${result.result?.task_error || "unknown error"}`);
    }
  }

  throw new Error("Baidu OCR timed out waiting for task result.");
}