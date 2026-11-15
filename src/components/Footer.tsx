'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { site } from '@/data/site';

export function Footer() {
  const path = usePathname();
  if (path.startsWith('/embed')) return null;
  return (
    <footer className="site-footer wrap grid">
      <p className="site-footer__mark" aria-hidden="true">{site.name}</p>
      <div className="site-footer__col">
        <Link href="/view">Open the viewer</Link>
        <Link href="/targets">Five test targets</Link>
        <Link href="/craft">The observatory</Link>
        <Link href="/method">How the frames are made</Link>
      </div>
      <div className="site-footer__col">
        <a href="https://science.nasa.gov/mission/spherex/" target="_blank" rel="noopener noreferrer">SPHEREx at NASA Science</a>
        <a href="https://www.jpl.nasa.gov/missions/spherex/" target="_blank" rel="noopener noreferrer">SPHEREx at JPL</a>
        <a href="https://spherex.caltech.edu/" target="_blank" rel="noopener noreferrer">SPHEREx at Caltech</a>
        <a href="https://irsa.ipac.caltech.edu/Missions/spherex.html" target="_blank" rel="noopener noreferrer">The image archive (IRSA)</a>
        <a href={site.challengeUrl} target="_blank" rel="noopener noreferrer">The challenge: Planet X and SPHEREx</a>
      </div>
      <div className="site-footer__col">
        <p>Made for NASA Space Apps 2026{site.team.placeholder ? '' : ` by ${site.team.name}`}.</p>
        <a href={site.repoUrl} target="_blank" rel="noopener noreferrer">Source code on GitHub</a>
        <p className="muted">Images: NASA, JPL-Caltech, IPAC.</p>
      </div>
      <p className="site-footer__fine">SPHEREx is a joint project of the Jet Propulsion Laboratory and Caltech, funded by NASA. Full data credits are on the method page. This site is a hackathon entry and is not endorsed by NASA.</p>
    </footer>
  );
}
