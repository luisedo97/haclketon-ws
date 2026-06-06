import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

function isAuthRoute(req: HttpRequest<unknown>): boolean {
  return req.url.includes('/auth/login') || req.url.includes('/auth/register');
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const withToken =
    token && !isAuthRoute(req)
      ? req.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        })
      : req;

  return next(withToken).pipe(
    catchError((error) => {
      if (error?.status === 401 && !isAuthRoute(req)) {
        auth.logout();
      }
      return throwError(() => error);
    }),
  );
};
