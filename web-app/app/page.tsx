"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function RegisterPage() {
  const [serviceName, setServiceName] = useState("");
  const router = useRouter();

  const handleContinue = () => {
    const name = serviceName.trim();
    if (!name) return;
    router.push(`/setup?service=${encodeURIComponent(name)}`);
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6 page-enter">
      <div className="w-full max-w-md space-y-10">
        <div className="text-center space-y-3">
          <div className="text-5xl mb-4">🔐</div>
          <h1 className="text-3xl font-bold tracking-tight">2FA BLE</h1>
          <p className="text-muted-foreground text-lg">
            Turn your iPhone into a security key
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Register a service</CardTitle>
            <CardDescription>
              Pair your phone with a service to enable Bluetooth authentication
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="mx-auto w-48 h-48 border-2 border-dashed border-muted-foreground/25 rounded-2xl flex items-center justify-center bg-muted/30">
              <div className="text-center space-y-2">
                <div className="text-5xl opacity-60">📱</div>
                <p className="text-xs text-muted-foreground/60 font-medium uppercase tracking-wider">
                  QR Code
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-name">Service name</Label>
              <Input
                id="service-name"
                placeholder="e.g. GitHub, Banking, Work…"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleContinue()}
                autoFocus
              />
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={handleContinue}
              disabled={!serviceName.trim()}
            >
              Continue
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
