import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { services } from "../application/services";
import type { DocumentRecord } from "../domain/records";

export default function DocumentPreview({ document }: { document: DocumentRecord }) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void services.library
      .preview(document.id)
      .then((value) => {
        if (!cancelled) setImage(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [document.id, visible]);
  return (
    <div ref={host} className="grid h-full w-full place-items-center">
      {image ? (
        <img
          data-ui="document-preview"
          src={image}
          alt={t("library.previewAlt", { title: document.title })}
          className="max-h-[158px] max-w-[80%] bg-white object-contain shadow-[0_6px_18px_#1f385c2b]"
        />
      ) : (
        <div className="flex h-[158px] w-[122px] flex-col items-center justify-center gap-2 bg-white px-3 text-center text-[10px] text-subtle shadow-[0_6px_18px_#1f385c2b]">
          {failed && <FileText size={22} />}
          {t(failed ? "library.previewUnavailable" : "library.previewLoading")}
        </div>
      )}
    </div>
  );
}
