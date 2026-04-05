"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

function securityDescription(mode: string, distance: number): string {
  if (mode === "proximity") {
    if (distance >= 15)
      return "Automatically authenticates when your phone is in the same building";
    if (distance >= 8)
      return "Automatically authenticates when your phone is on the same floor";
    if (distance >= 4)
      return "Automatically authenticates when your phone is in the same room";
    if (distance >= 2)
      return "Automatically authenticates when your phone is at your desk";
    if (distance >= 1)
      return "Automatically authenticates when your phone is within arm's reach";
    return "Automatically authenticates when your phone is right next to your laptop";
  }
  if (distance <= 1) {
    return "Requires you to tap approve on your phone while it's right next to your laptop";
  }
  return "Requires you to tap approve on your phone from anywhere nearby";
}

function modeLabel(mode: string, distance: number): string {
  if (mode === "proximity") return "Proximity";
  if (distance <= 1) return "Tap + Close Proximity";
  return "Tap to Approve";
}

function ConfirmedContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const service = searchParams.get("service") || "Service";
  const mode = searchParams.get("mode") || "proximity";
  const distance = parseFloat(searchParams.get("distance") || "2");

  return (
    <div className="flex min-h-screen items-center justify-center p-6 page-enter">
      <div className="w-full max-w-md space-y-8 text-center">
        {/* Animated checkmark */}
        <div className="flex justify-center">
          <div className="checkmark-circle">
            <svg className="checkmark-svg" viewBox="0 0 52 52">
              <circle
                className="checkmark-circle-bg"
                cx="26"
                cy="26"
                r="24"
                fill="none"
              />
              <path
                className="checkmark-check"
                fill="none"
                d="M14 27l7 7 16-16"
              />
            </svg>
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            {service} registered
          </h1>
          <p className="text-muted-foreground">
            Your security key is ready to use
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-center gap-2">
              <span>{service}</span>
              <Badge variant="secondary">{modeLabel(mode, distance)}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Separator />
            <p className="text-muted-foreground leading-relaxed">
              {securityDescription(mode, distance)}
            </p>
          </CardContent>
        </Card>

        <Button
          size="lg"
          className="min-w-[200px] text-base"
          onClick={() =>
            router.push(`/auth?service=${encodeURIComponent(service)}`)
          }
        >
          Test it now
        </Button>
      </div>
    </div>
  );
}

export default function ConfirmedPage() {
  return (
    <Suspense>
      <ConfirmedContent />
    </Suspense>
  );
}
