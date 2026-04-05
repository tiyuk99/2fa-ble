"use client";

import { useState, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function sliderToDistance(value: number): number {
  // Maps 0–100 to 20m–0.3m (left = far, right = close)
  return Math.round((20 - (value / 100) * 19.7) * 10) / 10;
}

function distanceLabel(d: number): string {
  if (d >= 15) return "Same building";
  if (d >= 8) return "Same floor";
  if (d >= 4) return "Same room";
  if (d >= 2) return "At your desk";
  if (d >= 1) return "Within arm's reach";
  return "Right next to laptop";
}

function SetupContent() {
  const searchParams = useSearchParams();
  const service = searchParams.get("service") || "Service";
  const router = useRouter();

  const [selectedCard, setSelectedCard] = useState<
    "proximity" | "tap" | null
  >(null);
  const [sliderValue, setSliderValue] = useState(50);
  const [tapOption, setTapOption] = useState<"tap" | "tap_close" | null>(null);
  const [registering, setRegistering] = useState(false);

  const distance = sliderToDistance(sliderValue);
  // Phone icon position: slider 0 = far (right side), slider 100 = close (near laptop)
  const phonePosition = 20 + (sliderValue / 100) * 60;

  const handleRegister = useCallback(async () => {
    if (registering) return;
    setRegistering(true);

    let mode: string;
    let dist: number;

    if (selectedCard === "proximity") {
      mode = "proximity";
      dist = distance;
    } else if (tapOption === "tap_close") {
      mode = "tap";
      dist = 0.3;
    } else {
      mode = "tap";
      dist = 20;
    }

    try {
      await fetch("http://localhost:8000/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: service, mode, distance: dist }),
      });

      const params = new URLSearchParams({
        service,
        mode,
        distance: dist.toString(),
      });
      router.push(`/confirmed?${params.toString()}`);
    } catch {
      setRegistering(false);
    }
  }, [registering, selectedCard, distance, tapOption, service, router]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6 page-enter">
      <div className="w-full max-w-3xl space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            How should{" "}
            <span className="text-primary">{service}</span>{" "}
            authenticate you?
          </h1>
          <p className="text-muted-foreground">
            Choose between automatic proximity or manual approval
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card A — Proximity (no tap) */}
          <Card
            className={`cursor-pointer transition-all duration-300 ${
              selectedCard === "proximity"
                ? "ring-2 ring-primary shadow-lg"
                : selectedCard === "tap"
                  ? "opacity-40 hover:opacity-70"
                  : "hover:ring-1 hover:ring-primary/50"
            }`}
            onClick={() => setSelectedCard("proximity")}
          >
            <CardHeader>
              <CardTitle>Automatic (no tap)</CardTitle>
              <CardDescription>
                Authenticates based on how close your phone is
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                <div className="flex justify-between text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  <span>Same building</span>
                  <span>Right next to laptop</span>
                </div>
                <Slider
                  value={[sliderValue]}
                  onValueChange={(v: number[]) => {
                    setSelectedCard("proximity");
                    setSliderValue(v[0]);
                  }}
                  min={0}
                  max={100}
                  step={1}
                />
              </div>

              <div className="flex justify-center">
                <Badge
                  variant="secondary"
                  className="text-sm font-mono px-4 py-1.5 transition-all duration-200"
                >
                  Within {distance} meters — {distanceLabel(distance)}
                </Badge>
              </div>

              {/* Visual distance indicator */}
              <div className="relative h-14 rounded-xl bg-muted/50 overflow-hidden">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-xl select-none">
                  💻
                </div>
                <div
                  className="absolute top-1/2 -translate-y-1/2 text-xl transition-all duration-300 ease-out select-none"
                  style={{ left: `${100 - phonePosition}%` }}
                >
                  📱
                </div>
                <div
                  className="absolute h-px top-1/2 -translate-y-1/2 distance-line transition-all duration-300"
                  style={{
                    left: "2.5rem",
                    width: `calc(${100 - phonePosition}% - 2.5rem)`,
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Card B — Tap required */}
          <Card
            className={`cursor-pointer transition-all duration-300 ${
              selectedCard === "tap"
                ? "ring-2 ring-primary shadow-lg"
                : selectedCard === "proximity"
                  ? "opacity-40 hover:opacity-70"
                  : "hover:ring-1 hover:ring-primary/50"
            }`}
            onClick={() => {
              setSelectedCard("tap");
              if (!tapOption) setTapOption("tap");
            }}
          >
            <CardHeader>
              <CardTitle>Tap required</CardTitle>
              <CardDescription>
                Manually approve each authentication on your phone
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={tapOption || ""}
                onValueChange={(v: string) => {
                  setSelectedCard("tap");
                  setTapOption(v as "tap" | "tap_close");
                }}
                className="space-y-2"
              >
                <div
                  className={`flex items-start gap-3 p-4 rounded-xl transition-colors ${
                    tapOption === "tap"
                      ? "bg-muted"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value="tap" id="tap" className="mt-0.5" />
                  <Label
                    htmlFor="tap"
                    className="cursor-pointer leading-relaxed font-normal"
                  >
                    Tap approve on your phone
                  </Label>
                </div>
                <div
                  className={`flex items-start gap-3 p-4 rounded-xl transition-colors ${
                    tapOption === "tap_close"
                      ? "bg-muted"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem
                    value="tap_close"
                    id="tap_close"
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="tap_close"
                    className="cursor-pointer leading-relaxed font-normal"
                  >
                    Tap approve + phone right next to laptop
                  </Label>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-center pt-2">
          <Button
            size="lg"
            className="min-w-[260px] text-base"
            disabled={
              !selectedCard ||
              (selectedCard === "tap" && !tapOption) ||
              registering
            }
            onClick={handleRegister}
          >
            {registering ? "Registering…" : `Register ${service}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense>
      <SetupContent />
    </Suspense>
  );
}
