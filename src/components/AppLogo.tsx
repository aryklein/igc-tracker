export function AppLogo() {
  return (
    <svg className="app-logo" viewBox="0 0 96 96" aria-hidden="true">
      <circle className="app-logo-ring" cx="48" cy="48" r="42" />
      <path className="app-logo-wing" d="M22 42C29 22 58 16 76 32C62 28 49 31 37 40C30 45 25 47 22 42Z" />
      <path className="app-logo-highlight" d="M47 29C59 25 68 28 76 35" />
      <path className="app-logo-line" d="M24 44L46 66" />
      <path className="app-logo-line" d="M38 40L48 66" />
      <path className="app-logo-line" d="M57 34L52 65" />
      <path className="app-logo-line" d="M73 35L56 66" />
      <circle className="app-logo-pilot" cx="50" cy="67" r="5" />
      <path className="app-logo-pilot" d="M43 74C44 66 55 64 61 72L66 81L61 84L55 77L48 79C44 80 42 78 43 74Z" />
      <path className="app-logo-track" d="M18 61C25 70 34 77 45 82" />
    </svg>
  );
}
