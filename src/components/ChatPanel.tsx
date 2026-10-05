import { useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  SimpleImageAttachmentAdapter,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import { Check, Copy, MessageSquarePlus, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { services } from "../application/services";
import type {
  ChatImage,
  ChatMessage,
  ChatThread,
  DocumentRecord,
  Provider,
} from "../domain/records";
import type { ReaderSelection } from "../domain/reader";
import MathMarkdown from "../sdk/MathMarkdown";
import ChatComposer from "./ChatComposer";
import { cx, ui } from "../sdk/ui/styles";
import { useTranslation } from "react-i18next";
import { message as noticeMessage } from "../domain/messages";

// Empty is the new language-neutral default. Recognize existing local threads.
const isUntitled = (title: string) => title === "" || title === "新对话";

interface Props {
  document: DocumentRecord;
  page: number;
  selection: ReaderSelection | null;
  provider: Provider | null;
  providers: Provider[];
  vision: boolean;
  onSelectModel: (providerId: string, modelId: string) => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onError: (error: string) => void;
}

function contentText(message: AppendMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function ChatBubble({
  onEdit,
  onDelete,
  onRegenerate,
}: {
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onRegenerate: (id: string) => void;
}) {
  const { t } = useTranslation();
  const message = useAuiState((state) => state.message);
  const [copied, setCopied] = useState(false);
  const content = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  return (
    <MessagePrimitive.Root className="group/message mb-[18px] flex items-start gap-2">
      <div
        className={cx(
          ui.avatar,
          "size-[25px] text-[11px]",
          message.role === "user" ? "bg-[#eaf0f6] text-[#65809c]" : "bg-[#e9f1ff] text-[#3976c9]",
        )}
      >
        {message.role === "user" ? t("chat.me") : "✦"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mt-1 mb-[7px] text-[10px] font-bold text-[#4b6380]">
          {message.role === "user" ? t("chat.you") : "Cachalot"}
        </div>
        {message.role === "user" && message.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.attachments.flatMap((attachment) =>
              attachment.content
                .filter((part) => part.type === "image")
                .map((part, index) => (
                  <img
                    key={`${attachment.id}-${index}`}
                    data-ui="message-image"
                    src={part.image}
                    alt={t("chat.imageAlt", { name: attachment.name })}
                    className="max-h-[200px] max-w-full rounded-lg border border-[#d8e3f0] object-contain"
                  />
                )),
            )}
          </div>
        )}
        <MathMarkdown
          className={cx(
            "text-[11px] leading-[1.72] text-[#2b3f57]",
            message.role === "user" && "rounded-lg bg-[#f3f7fc] px-[11px] py-[9px]",
          )}
        >
          {content || (message.role === "assistant" ? "…" : "")}
        </MathMarkdown>
        <div className="mt-1 flex gap-[5px] opacity-0 group-focus-within/message:opacity-100 group-hover/message:opacity-100 [&>button]:border-0 [&>button]:bg-transparent [&>button]:p-[3px] [&>button]:text-[#9badc1] [&>button:hover]:text-[#276dc6]">
          <button
            title={t("common.copy")}
            onClick={() => {
              void navigator.clipboard.writeText(content).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          {message.role === "user" && (
            <button title={t("common.edit")} onClick={() => onEdit(message.id, content)}>
              <Pencil size={14} />
            </button>
          )}
          {message.role === "assistant" && (
            <button title={t("chat.regenerate")} onClick={() => onRegenerate(message.id)}>
              <RefreshCw size={14} />
            </button>
          )}
          <button title={t("common.delete")} onClick={() => onDelete(message.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

export default function ChatPanel({
  document,
  page,
  selection,
  provider,
  providers,
  vision,
  onSelectModel,
  onClose,
  onOpenSettings,
  onError,
}: Props) {
  const { t } = useTranslation();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const messagesRef = useRef<ChatMessage[]>([]);
  const threadRef = useRef<string | null>(null);
  const imageAdapter = useMemo(() => {
    const adapter = new SimpleImageAttachmentAdapter();
    adapter.accept = "image/png,image/jpeg,image/webp,image/gif";
    return adapter;
  }, []);

  const publish = (next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRunning(false);
    publish([]);
    setThreadId(null);
    threadRef.current = null;
    void services.conversations
      .list(document.id)
      .then(async (items) => {
        if (cancelled) return;
        setThreads(items);
        if (items[0]) {
          const next = await services.conversations.messages(items[0].id);
          if (!cancelled) {
            threadRef.current = items[0].id;
            setThreadId(items[0].id);
            publish(next);
          }
        }
      })
      .catch((cause: unknown) => onError(String(cause)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [document.id]);

  const chooseThread = async (id: string) => {
    if (running) return;
    try {
      await runtime.thread.composer.reset();
      const next = await services.conversations.messages(id);
      threadRef.current = id;
      setThreadId(id);
      publish(next);
    } catch (cause) {
      onError(String(cause));
    }
  };

  const newThread = () => {
    if (!running) {
      void runtime.thread.composer.reset().catch((cause) => onError(String(cause)));
      threadRef.current = null;
      setThreadId(null);
      publish([]);
    }
  };

  const ensureThread = async (): Promise<string> => {
    if (threadRef.current) return threadRef.current;
    const thread = await services.conversations.create(document.id);
    threadRef.current = thread.id;
    setThreadId(thread.id);
    setThreads((current) => [thread, ...current]);
    return thread.id;
  };

  const run = async (history: ChatMessage[], question: string, id: string) => {
    if (!provider?.modelId) {
      onError(noticeMessage("configureModel"));
      return;
    }
    const assistant: ChatMessage = {
      id: crypto.randomUUID(),
      threadId: id,
      parentId: history.at(-1)?.id || null,
      role: "assistant",
      content: "",
      sourcePage: page,
      sourceRegion: null,
      providerId: provider.id,
      modelId: provider.modelId,
      createdAt: Date.now(),
    };
    publish([...history, assistant]);
    setRunning(true);
    try {
      let answer = "";
      const content = await services.assistant.askPaper(
        { document, page, selection, provider, question, history },
        (delta) => {
          answer += delta;
          if (threadRef.current === id)
            publish(
              messagesRef.current.map((message) =>
                message.id === assistant.id ? { ...message, content: answer } : message,
              ),
            );
        },
      );
      const finished = { ...assistant, content };
      if (threadRef.current === id)
        publish(
          messagesRef.current.map((message) => (message.id === assistant.id ? finished : message)),
        );
      await services.conversations.saveMessage(finished);
    } catch (cause) {
      if (threadRef.current === id) {
        publish(messagesRef.current.filter((message) => message.id !== assistant.id));
        onError(String(cause));
      }
    } finally {
      if (threadRef.current === id) setRunning(false);
    }
  };

  const submit = async (message: AppendMessage) => {
    const content = contentText(message);
    const images: ChatImage[] =
      message.role === "user"
        ? (message.attachments || []).flatMap((attachment) =>
            attachment.content
              .filter((part) => part.type === "image")
              .map((part) => ({
                id: attachment.id,
                name: attachment.name,
                contentType: attachment.contentType || "image/png",
                dataUrl: part.image,
              })),
          )
        : [];
    if ((!content && !images.length) || running) return;
    if (images.length && !vision) {
      onError(noticeMessage("imageUnsupported"));
      return;
    }
    if (!provider?.modelId) {
      onError(noticeMessage("configureModel"));
      return;
    }
    try {
      const id = await ensureThread();
      const user: ChatMessage = {
        id: crypto.randomUUID(),
        threadId: id,
        parentId: messagesRef.current.at(-1)?.id || null,
        role: "user",
        content,
        images,
        sourcePage: selection?.page || page,
        sourceRegion: selection
          ? JSON.stringify({
              x: selection.x,
              y: selection.y,
              width: selection.width,
              height: selection.height,
            })
          : null,
        providerId: null,
        modelId: null,
        createdAt: Date.now(),
      };
      const history = [...messagesRef.current, user];
      publish(history);
      await services.conversations.saveMessage(user);
      const currentThread = threads.find((item) => item.id === id);
      if (!currentThread || isUntitled(currentThread.title)) {
        const title = (content || images[0]?.name || t("chat.imageQuestion")).slice(0, 24);
        await services.conversations.rename(id, title);
        setThreads((current) =>
          current.map((item) => (item.id === id ? { ...item, title } : item)),
        );
      }
      await run(history, content, id);
    } catch (cause) {
      onError(String(cause));
    }
  };

  const removeMessage = async (id: string) => {
    if (running) return;
    try {
      await services.conversations.removeMessage(id);
      publish(messagesRef.current.filter((message) => message.id !== id));
    } catch (cause) {
      onError(String(cause));
    }
  };

  const regenerate = async (id: string) => {
    if (running) return;
    const index = messagesRef.current.findIndex((message) => message.id === id);
    const prior = messagesRef.current.slice(0, index);
    const question = [...prior].reverse().find((message) => message.role === "user");
    if (!question || !threadRef.current) return;
    try {
      for (const message of messagesRef.current.slice(index))
        await services.conversations.removeMessage(message.id);
      publish(prior);
      await run(prior, question.content, threadRef.current);
    } catch (cause) {
      onError(String(cause));
    }
  };

  const saveEdit = async () => {
    if (!editing || !threadRef.current) return;
    const index = messagesRef.current.findIndex((message) => message.id === editing.id);
    if (index < 0) return;
    try {
      for (const message of messagesRef.current.slice(index))
        await services.conversations.removeMessage(message.id);
      const revised = { ...messagesRef.current[index], content: editing.content.trim() };
      const history = [...messagesRef.current.slice(0, index), revised];
      await services.conversations.saveMessage(revised);
      publish(history);
      setEditing(null);
      await run(history, revised.content, threadRef.current);
    } catch (cause) {
      onError(String(cause));
    }
  };

  const deleteThread = async (id: string) => {
    if (running || !window.confirm(t("chat.deleteConfirm"))) return;
    try {
      await services.conversations.remove(id);
      const remaining = threads.filter((thread) => thread.id !== id);
      setThreads(remaining);
      if (threadRef.current === id) {
        threadRef.current = null;
        setThreadId(null);
        publish([]);
        if (remaining[0]) await chooseThread(remaining[0].id);
      }
    } catch (cause) {
      onError(String(cause));
    }
  };

  const runtime = useExternalStoreRuntime<ChatMessage>({
    messages,
    // Keep the adapter alive when changing models so pending images can still
    // be removed or sent after switching back. Composer guards block sending
    // them to a text model; request construction separately filters history.
    adapters: { attachments: imageAdapter },
    isRunning: running,
    isLoading: loading,
    convertMessage: (message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      attachments:
        message.role === "user"
          ? (message.images || []).map((image) => ({
              id: image.id,
              type: "image",
              name: image.name,
              contentType: image.contentType,
              status: { type: "complete" as const },
              content: [{ type: "image" as const, image: image.dataUrl }],
            }))
          : [],
      createdAt: new Date(message.createdAt),
    }),
    onNew: submit,
    onDelete: removeMessage,
    onReload: async (parentId) => {
      const index = messagesRef.current.findIndex((message) => message.id === parentId);
      const next = messagesRef.current[index + 1];
      if (next?.role === "assistant") await regenerate(next.id);
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <aside
        data-ui="chat-panel"
        className="flex min-h-0 w-[356px] flex-none flex-col border-l border-[#dfe7f1] bg-white max-desktop:w-[315px] max-compact:w-[290px]"
      >
        <header className="flex h-[63px] flex-none items-center gap-[10px] border-b border-[#edf1f6] px-[15px] [&_small]:block [&_small]:text-[8px] [&_small]:tracking-[.12em] [&_small]:text-[#91a1b5] [&_strong]:mt-[3px] [&_strong]:block [&_strong]:text-[12px] [&>div]:flex-1">
          <span className="grid size-[29px] place-items-center rounded-button bg-[#e9f1ff] text-[18px] text-[#3374d0]">
            ✦
          </span>
          <div>
            <small>{t("chat.eyebrow")}</small>
            <strong>{t("chat.title")}</strong>
          </div>
          <button className={ui.iconButton} onClick={onClose} title={t("chat.close")}>
            <X size={18} />
          </button>
        </header>
        <div className="min-h-[70px] border-b border-[#edf1f6] px-[14px] pt-3 pb-[9px] [&>button]:float-right [&>button]:flex [&>button]:items-center [&>button]:gap-[5px] [&>button]:border-0 [&>button]:bg-transparent [&>button]:text-[10px] [&>button]:text-[#3a78c9] [&>span]:text-[10px] [&>span]:text-[#90a0b1]">
          <span>{t("chat.history")}</span>
          <button onClick={newThread}>
            <MessageSquarePlus size={14} />
            {t("chat.new")}
          </button>
          <div className="mt-[13px] flex gap-[6px] overflow-x-auto pb-[2px]">
            {threads.map((thread) => (
              <div
                key={thread.id}
                data-active={threadId === thread.id}
                className="flex max-w-[180px] flex-none items-center rounded-[7px] border border-[#e2eaf5] bg-[#f8fafd] data-[active=true]:border-[#aac8f0] data-[active=true]:bg-[#edf4ff]"
              >
                <button
                  className="truncate border-0 bg-transparent px-[7px] py-[5px] text-[10px] text-[#6b7f99]"
                  onClick={() => void chooseThread(thread.id)}
                  title={isUntitled(thread.title) ? t("chat.new") : thread.title}
                >
                  {isUntitled(thread.title) ? t("chat.new") : thread.title}
                </button>
                <button
                  className="border-0 bg-transparent py-[5px] pr-[7px] pl-0 text-[10px] text-[#9babbd]"
                  title={t("chat.deleteConversation")}
                  onClick={() => void deleteThread(thread.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-[15px] py-[18px]">
            {messages.length === 0 && (
              <div className="px-[14px] pt-[65px] pb-[30px] text-center [&>h2]:mb-[10px] [&>h2]:text-[16px] [&>p]:text-[11px] [&>p]:leading-[1.7] [&>p]:text-[#91a0b1]">
                <div className="mb-[15px] text-[28px] text-[#548ce2]">✦</div>
                <h2>{t("chat.welcome")}</h2>
                <p>{t("chat.description")}</p>
                <div className="mt-[22px] flex flex-wrap justify-center gap-[7px] [&>button]:rounded-2xl [&>button]:border [&>button]:border-[#e4eefb] [&>button]:bg-[#f3f7fe] [&>button]:px-[10px] [&>button]:py-[6px] [&>button]:text-[10px] [&>button]:text-[#4777b3]">
                  <button
                    onClick={() => {
                      void runtime.thread.append({
                        role: "user",
                        content: [{ type: "text", text: t("chat.contributionsQuestion") }],
                      });
                    }}
                  >
                    {t("chat.contributions")}
                  </button>
                  <button
                    onClick={() => {
                      void runtime.thread.append({
                        role: "user",
                        content: [{ type: "text", text: t("chat.methodsQuestion") }],
                      });
                    }}
                  >
                    {t("chat.methods")}
                  </button>
                </div>
              </div>
            )}
            <ThreadPrimitive.Messages
              components={{
                Message: () => (
                  <ChatBubble
                    onEdit={(id, content) => setEditing({ id, content })}
                    onDelete={(id) => void removeMessage(id)}
                    onRegenerate={(id) => void regenerate(id)}
                  />
                ),
              }}
            />
            {running && <p className="text-[10px] text-[#7391b7]">{t("chat.answering")}</p>}
          </ThreadPrimitive.Viewport>
          {editing && (
            <div className="border-t border-[#e6edf5] px-[14px] py-[11px] [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:text-[11px] [&>textarea]:my-2 [&>textarea]:block [&>textarea]:w-full [&>textarea]:resize-y [&>textarea]:rounded-[6px] [&>textarea]:border [&>textarea]:border-[#d8e2ef] [&>textarea]:p-[7px] [&>textarea]:text-[11px]">
              <div>
                <strong>{t("chat.editQuestion")}</strong>
                <button
                  className={ui.iconButton}
                  onClick={() => setEditing(null)}
                  aria-label={t("common.cancel")}
                >
                  <X size={15} />
                </button>
              </div>
              <textarea
                value={editing.content}
                onChange={(event) => setEditing({ ...editing, content: event.target.value })}
                rows={4}
              />
              <button
                className={cx(ui.primaryButton, "w-full")}
                disabled={!editing.content.trim() || running}
                onClick={() => void saveEdit()}
              >
                {t("chat.saveAndAnswer")}
              </button>
            </div>
          )}
          {selection && (
            <div className="mx-[15px] mb-[7px] truncate rounded-[7px] border border-[#dbeafb] bg-[#f2f7ff] px-2 py-[6px] text-[9px] text-[#567eb0]">
              {t("chat.selection", {
                page: selection.page,
                text: selection.text.slice(0, 36) || t("common.image"),
              })}
            </div>
          )}
          {!provider?.modelId && (
            <button
              className="mx-[15px] mb-2 rounded-[7px] border-0 bg-[#fff8ed] p-[9px] text-[10px] text-[#9a6c24]"
              onClick={onOpenSettings}
            >
              {t("chat.configure")}
            </button>
          )}
          <ChatComposer
            runtime={runtime}
            provider={provider}
            providers={providers}
            vision={vision}
            running={running}
            onSelectModel={onSelectModel}
            onOpenSettings={onOpenSettings}
            onError={onError}
          />
        </ThreadPrimitive.Root>
      </aside>
    </AssistantRuntimeProvider>
  );
}
