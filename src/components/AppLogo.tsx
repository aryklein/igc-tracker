import Image from "next/image";

export function AppLogo() {
  return <Image className="app-logo" src="/vuel-logo.svg" alt="" aria-hidden="true" width={320} height={175} priority />;
}
