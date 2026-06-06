import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

const TOKEN_KEY = 'ws-spy.token';
const USER_KEY = 'ws-spy.user';

export type UserRole = 'ADMIN' | 'MEMBER';

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  phoneE164: string | null;
  createdAt: string;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export interface LinkCodeResult {
  code: string;
  expiresAt: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly baseUrl =
    window.wsSpy?.apiUrl ?? 'http://localhost:3000';

  readonly token = signal<string | null>(this.readToken());
  readonly currentUser = signal<PublicUser | null>(this.readUser());

  constructor(private readonly http: HttpClient) {}

  register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Observable<AuthResult> {
    return this.http
      .post<AuthResult>(`${this.baseUrl}/auth/register`, input)
      .pipe(tap((res) => this.applyAuthResult(res)));
  }

  login(input: { email: string; password: string }): Observable<AuthResult> {
    return this.http
      .post<AuthResult>(`${this.baseUrl}/auth/login`, input)
      .pipe(tap((res) => this.applyAuthResult(res)));
  }

  fetchMe(): Observable<PublicUser> {
    return this.http
      .get<PublicUser>(`${this.baseUrl}/auth/me`)
      .pipe(tap((user) => this.persistUser(user)));
  }

  generateLinkCode(): Observable<LinkCodeResult> {
    return this.http.post<LinkCodeResult>(
      `${this.baseUrl}/auth/link-code`,
      {},
    );
  }

  logout() {
    this.token.set(null);
    this.currentUser.set(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
  }

  isAuthenticated(): boolean {
    return !!this.token();
  }

  private applyAuthResult(result: AuthResult) {
    this.token.set(result.token);
    this.currentUser.set(result.user);
    try {
      localStorage.setItem(TOKEN_KEY, result.token);
      this.persistUser(result.user);
    } catch {
      /* ignore */
    }
  }

  private persistUser(user: PublicUser) {
    this.currentUser.set(user);
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* ignore */
    }
  }

  private readToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  private readUser(): PublicUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as PublicUser) : null;
    } catch {
      return null;
    }
  }
}
