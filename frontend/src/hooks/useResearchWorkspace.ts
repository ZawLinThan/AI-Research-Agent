import { useEffect, useRef, useState } from "react";
import type { ResearchProject } from "../../../shared/research";
import { researchApi } from "../lib/researchApi";
import { done } from "../lib/researchPresentation";
export const useResearchWorkspace = ({
  userId,
  onLogin,
}: {
  userId?: string;
  onLogin: () => void;
}) => {
  const [page, setPage] = useState("Overview"),
    [prompt, setPrompt] = useState(""),
    [depth, setDepth] = useState("Deep research"),
    [scope, setScope] = useState("Web & academic");
  const [projects, setProjects] = useState<ResearchProject[]>([]),
    [selectedId, setSelectedId] = useState(() =>
      new URLSearchParams(location.search).get("research"),
    ),
    [detail, setDetail] = useState<ResearchProject | null>(null);
  const [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(!!userId),
    [menu, setMenu] = useState(false),
    [help, setHelp] = useState(false),
    [reload, setReload] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null),
    request = useRef<{
      fingerprint: string;
      id: string;
    } | null>(null);
  useEffect(() => {
    const pop = () => {
      setSelectedId(new URLSearchParams(location.search).get("research"));
      setDetail(null);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const poll = async () => {
      try {
        const data = await researchApi<{
          projects: ResearchProject[];
        }>("", {
          signal: abort.signal,
        });
        if (active) {
          setProjects(data.projects);
          setError("");
        }
      } catch (err) {
        if (active)
          setError(
            err instanceof Error ? err.message : "Unable to load research.",
          );
      } finally {
        if (active) {
          setLoading(false);
          timer = setTimeout(poll, 3000);
        }
      }
    };
    void poll();
    return () => {
      active = false;
      abort.abort();
      clearTimeout(timer);
    };
  }, [userId, reload]);
  useEffect(() => {
    if (!userId || !selectedId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const poll = async () => {
      try {
        const result = await researchApi<ResearchProject>(`/${selectedId}`, {
          signal: abort.signal,
        });
        if (active) {
          setDetail(result);
          if (!done(result.status)) timer = setTimeout(poll, 2500);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Unable to load research.",
          );
          timer = setTimeout(poll, 5000);
        }
      }
    };
    void poll();
    return () => {
      active = false;
      abort.abort();
      clearTimeout(timer);
    };
  }, [userId, selectedId, reload]);
  const open = (id: string | null) => {
    setDetail(null);
    setError("");
    setSelectedId(id);
    history.pushState({}, "", id ? `/?research=${id}` : "/");
  };
  const navigate = (next: string) => {
    setPage(next);
    setMenu(false);
    setQuery("");
    open(null);
  };
  const newResearch = (value = "") => {
    navigate("Overview");
    setPrompt(value);
    setTimeout(() => textarea.current?.focus(), 0);
  };
  const start = async () => {
    if (!userId) {
      onLogin();
      return;
    }
    if (prompt.trim().length < 10) {
      setError("Please enter a question with at least 10 characters.");
      return;
    }
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify({
      question: prompt.trim(),
      depth,
      scope,
    });
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const result = await researchApi<{
        projectId: string;
      }>("", {
        method: "POST",
        body: JSON.stringify({
          ...JSON.parse(fingerprint),
          requestId: request.current.id,
        }),
      });
      setPrompt("");
      request.current = null;
      open(result.projectId);
      setReload((v) => v + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to start research.",
      );
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      setDetail(
        await researchApi<ResearchProject>(`/${detail.id}/cancel`, {
          method: "POST",
        }),
      );
      setReload((v) => v + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to cancel research.",
      );
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    if (!detail?.report) return;
    const url = URL.createObjectURL(
      new Blob([detail.report], { type: "text/markdown" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "fieldwork-research.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const visible = projects.filter((p) =>
    p.question.toLowerCase().includes(query.toLowerCase()),
  );
  return {
    page,
    prompt,
    depth,
    scope,
    projects,
    selectedId,
    detail,
    query,
    error,
    busy,
    loading,
    menu,
    help,
    textarea,
    visible,
    setPrompt,
    setDepth,
    setScope,
    setQuery,
    setMenu,
    setHelp,
    setReload,
    open,
    navigate,
    newResearch,
    start,
    cancel,
    download,
    userId,
    onLogin,
  };
};
export type WorkspaceViewProps = ReturnType<typeof useResearchWorkspace>;
