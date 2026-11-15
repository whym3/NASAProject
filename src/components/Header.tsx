'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { site } from '@/data/site';
import { Hop } from './Hop';

export function Header() {
  const path = usePathname();
  if (path.startsWith('/embed')) return null;
  return (
    <header className="site-header">
      <Link href="/" className="wordmark" aria-label={`${site.name}, home`}>
        {/* SPHEREx in outline: three nested shields over the bus. The intro's spacecraft lands here. */}
        <svg className="wordmark__craft" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2 4 L8 16 H16 L22 4" /><path d="M6 4 L10 16" /><path d="M18 4 L14 16" />
          <path d="M9 16 V21 H15 V16" /><line x1="2" y1="4" x2="22" y2="4" />
        </svg>
        <span className="hop__t">{site.name}</span>
        <span className="lamp" aria-hidden="true"><i /><i /></span>
      </Link>
      <nav className="site-nav" aria-label="Main">
        {site.nav.map((n) => (
          <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? 'page' : undefined}>
            <Hop>{n.label}</Hop>
          </Link>
        ))}
        <a className="site-nav__repo" href={site.repoUrl} target="_blank" rel="noopener noreferrer" aria-label="Source code on GitHub" title="Source code on GitHub">
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
      </nav>
    </header>
  );
}
