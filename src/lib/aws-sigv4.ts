import { SignatureV4 } from "@aws-sdk/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@aws-sdk/protocol-http";

export async function signAndFetchBedrock(opts: {
  region: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}) {
  const { region, method, url, headers = {}, body, accessKeyId, secretAccessKey, sessionToken } = opts;
  const signer = new SignatureV4({
    credentials: { accessKeyId, secretAccessKey, sessionToken },
    region,
    service: "bedrock",
    sha256: Sha256,
  });
  const { hostname, pathname, search, protocol } = new URL(url);
  const request = new HttpRequest({
    protocol,
    hostname,
    method,
    path: pathname + (search || ""),
    headers,
    body,
  });
  const signed = await signer.sign(request);
  const resp = await fetch(`${protocol}//${hostname}${signed.path}`, {
    method: signed.method,
    headers: signed.headers as Record<string, string>,
    body: body as BodyInit,
  });
  return resp;
}
