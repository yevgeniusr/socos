'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setToken, setUser } from '@/lib/auth';

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!inviteCode.trim()) {
      setError('Invite code is required to create an account');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      // Call Next.js API route → NestJS + set httpOnly cookie
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: name.trim() || undefined, inviteCode }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Registration failed. Check your invite code.');
      }
      if (!data.accessToken) {
        throw new Error('No access token received from server');
      }

      // Store token in localStorage for client-side auth checks
      // httpOnly cookie is set server-side by /api/auth/register route
      setToken(data.accessToken);
      setUser(data.user);

      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
    <div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-8">
      <h2
        className="text-xl font-bold mb-6 text-on-surface"
        style={{ fontFamily: 'Manrope' }}
      >
        Create your account
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <input
            type="text"
            placeholder="Your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-surface-container-high border border-outline-variant/10 text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary transition-colors"
          />
        </div>
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-4 py-3 rounded-xl bg-surface-container-high border border-outline-variant/10 text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary transition-colors"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full px-4 py-3 rounded-xl bg-surface-container-high border border-outline-variant/10 text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary transition-colors"
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          className="w-full px-4 py-3 rounded-xl bg-surface-container-high border border-outline-variant/10 text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary transition-colors"
        />
        <div>
          <input
            type="text"
            placeholder="Invite code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-xl bg-surface-container-high border border-outline-variant/10 text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-tertiary transition-colors"
          />
          <p className="mt-1 text-[10px] text-tertiary/70">
            Ask Yev for an invite code to create an account
          </p>
        </div>

        {error && (
          <div className="px-4 py-3 rounded-xl bg-error-container text-error text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold text-base hover:brightness-110 transition-all active:scale-[0.98] disabled:opacity-60"
        >
          {loading ? 'Creating account...' : 'Create Account'}
        </button>
      </form>

      <p className="text-center mt-5 text-sm text-on-surface-variant">
        Already have an account?{' '}
        <Link
          href="/auth/login"
          className="text-primary font-semibold hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
    <div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-5">
      <h3 className="text-sm font-bold text-on-surface mb-3">Private alpha access</h3>
      <div className="space-y-3 text-xs text-on-surface-variant leading-relaxed">
        <p>
          Socos is currently invite-only while Yev imports his Monica contacts and connects Hermes, Calendar, and Pixel location in the Coolify cloud database.
        </p>
        <div className="grid grid-cols-1 gap-2">
          {[
            'Monica import, important dates, reminders, and relationship memory are the first private workflow.',
            'Hermes and MCP clients can read, summarize, and log safe activity; outbound messages, intros, merges, and deletes require approval.',
            'Calendar, location, and event discovery ship disabled-first until each integration is explicitly connected.',
            'Personal data has deletion, encryption, rekey, audit, and backup boundaries before public rollout.',
          ].map((item) => (
            <div key={item} className="rounded-xl bg-surface-container-high border border-outline-variant/10 p-3">
              {item}
            </div>
          ))}
        </div>
        <Link href="/#demo" className="inline-flex font-semibold text-primary hover:underline">
          View sample brief before signing up
        </Link>
      </div>
    </div>
    </div>
  );
}
