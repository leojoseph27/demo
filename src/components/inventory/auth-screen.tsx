'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useInventoryStore } from '@/store/inventory-store';
import { Package, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * AuthScreen — Login only, no registration.
 * Credentials are validated against environment variables on the server.
 * There is always exactly one admin; no setup form is needed.
 */
export function AuthScreen() {
  const { setAuthenticated } = useInventoryStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Email and password are required');
      return;
    }

    setIsLoading(true);
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        if (res.ok) {
          const data = await res.json();
          setAuthenticated(true, data);
          toast.success('Welcome back!');
          return;
        }

        if (res.status === 429) {
          // Rate limited — wait and retry
          attempt++;
          if (attempt < maxRetries) {
            const delay = attempt * 3000; // 3s, 6s, 9s
            toast.error(`Rate limited. Retrying in ${delay / 1000}s...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          toast.error('Too many login attempts. Please wait a minute and try again.');
          return;
        }

        const data = await res.json();
        toast.error(data.error || 'Invalid credentials');
        return;
      } catch (error) {
        toast.error('Login failed — server may be restarting. Please try again.');
        return;
      } finally {
        if (attempt >= maxRetries) {
          setIsLoading(false);
        }
      }
    }

    setIsLoading(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4 bg-gradient-to-b from-background to-muted/30">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Package className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Product Catalog</h1>
          <p className="text-sm text-muted-foreground mt-1">Inventory & Catalog Management</p>
        </div>

        {/* Login Form — always shown, no setup/registration */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-center">Sign In</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@company.com"
                  className="h-11"
                  required
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="h-11"
                  required
                  disabled={isLoading}
                />
              </div>
              <Button type="submit" className="w-full h-11" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
