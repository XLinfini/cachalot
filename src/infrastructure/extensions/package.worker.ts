import { parseExtensionPackage } from "./package";
self.onmessage = async (event: MessageEvent<Uint8Array>) => {
  try {
    self.postMessage({ value: await parseExtensionPackage(event.data) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
