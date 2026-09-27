import { useState } from "react";
import { Globe2 } from "lucide-react";
import type { Source } from "../../../shared/research";

export const SourceLogo = ({ source }: { source: Source }) => {
  const [failedUrl, setFailedUrl] = useState<string>();
  let logo: string | undefined;
  try {
    const url = new URL(source.url);
    if (["http:", "https:"].includes(url.protocol)) {
      logo = `${url.origin}/favicon.ico`;
      if (
        source.logo &&
        ["http:", "https:"].includes(new URL(source.logo).protocol)
      ) {
        logo = source.logo;
      }
    }
  } catch {
    /* Use the globe for unavailable icons. */
  }
  return logo && failedUrl !== logo ? (
    <img
      className="source-logo"
      src={logo}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(logo)}
    />
  ) : (
    <Globe2 className="source-logo" aria-hidden="true" size={16} />
  );
};
