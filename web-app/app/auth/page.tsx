"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface AuthStep {
  step: string;
  icon: string;
  label: string;
  status?: string;
}

function AuthContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const service = searchParams.get("service") || "Service";
  const [steps, setSteps] = useState<AuthStep[]>([]);
  const [result, setResult] = useState<AuthStep | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [runKey, setRunKey] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    setSteps([]);
    setResult(null);
    setActiveIndex(-1);

    const eventSource = new EventSource(
      `http://localhost:8000/auth-stream/${encodeURIComponent(service)}`
    );

    eventSource.onmessage = (event) => {
      const data: AuthStep = JSON.parse(event.data);

      if (data.step === "result") {
        doneRef.current = true;
        setResult(data);
        eventSource.close();
      } else if (data.step === "error") {
        doneRef.current = true;
        setResult({
          step: "result",
          icon: "🔴",
          label: data.label || "ERROR",
          status: "rejected",
        });
        eventSource.close();
      } else {
        setSteps((prev) => {
          const next = [...prev, data];
          setActiveIndex(next.length - 1);
          return next;
        });
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      // SSE fires onerror when the stream ends naturally — ignore if we
      // already received the final result event.
      if (doneRef.current) return;
      doneRef.current = true;
      setResult({
        step: "result",
        icon: "🔴",
        label: "COULD NOT REACH SERVER",
        status: "rejected",
      });
    };

    return () => {
      eventSource.close();
    };
  }, [service, runKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps, result]);

  const isAuthenticated = result?.status === "authenticated";

  return (
    <div className="flex min-h-screen items-center justify-center p-6 page-enter">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-3">
          <h1 className="text-2xl font-bold tracking-tight">Authenticating</h1>
          <Badge variant="secondary" className="text-sm px-4 py-1">
            {service}
          </Badge>
        </div>

        <div className="space-y-3">
          {steps.map((step, i) => (
            <Card
              key={step.step}
              className={`transition-all duration-500 ${
                i === activeIndex && !result ? "pulse-glow" : ""
              }`}
              style={{
                animation: `page-fade-in 0.4s ease-out ${i * 0.05}s both`,
              }}
            >
              <CardContent className="flex items-center gap-4 py-3">
                <span className="text-xl w-8 text-center shrink-0">
                  {step.icon}
                </span>
                <span className="text-sm font-medium">{step.label}</span>
                {i < activeIndex || result ? (
                  <span className="ml-auto text-xs text-muted-foreground">
                    ✓
                  </span>
                ) : i === activeIndex && !result ? (
                  <span className="ml-auto">
                    <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
                  </span>
                ) : null}
              </CardContent>
            </Card>
          ))}

          {result && (
            <Card
              className={`transition-all duration-500 ${
                isAuthenticated
                  ? "ring-2 ring-green-500/60 bg-green-500/5"
                  : "ring-2 ring-red-500/60 bg-red-500/5"
              }`}
              style={{
                animation: "page-fade-in 0.5s ease-out both",
              }}
            >
              <CardContent className="flex flex-col items-center justify-center gap-2 py-8">
                <span className="text-4xl">{result.icon}</span>
                <span
                  className={`text-xl font-bold tracking-wide ${
                    isAuthenticated ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {result.label}
                </span>
                {result.label === "COULD NOT REACH SERVER" && (
                  <span className="text-sm text-muted-foreground mt-1">
                    Make sure Flask is running on localhost:8000
                  </span>
                )}
              </CardContent>
            </Card>
          )}

          <div ref={bottomRef} />
        </div>

        {result && (
          <div className="flex justify-center gap-3 pt-2">
            <Button variant="secondary" onClick={() => router.push("/")}>
              Register another
            </Button>
            <Button onClick={() => setRunKey((k) => k + 1)}>Run again</Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthContent />
    </Suspense>
  );
}
