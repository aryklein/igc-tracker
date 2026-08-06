import Image from "next/image";

export function AppLogo() {
  return <Image className="app-logo" src="/vuel-logo.svg" alt="" aria-hidden="true" width={250} height={136} priority />;
}
