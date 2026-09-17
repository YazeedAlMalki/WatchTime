import React from "react";

type OptimizedImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
};

function localOptimizedSource(src: string): string | null {
  if (!/^\/(?:posters|backdrops)\//.test(src) || !src.endsWith(".jpg")) {
    return null;
  }
  return src.replace(/\.jpg$/, ".webp");
}

export function OptimizedImage({
  src,
  alt,
  loading = "lazy",
  decoding = "async",
  ...props
}: OptimizedImageProps) {
  const webp = localOptimizedSource(src);

  if (!webp) {
    return <img src={src} alt={alt} loading={loading} decoding={decoding} {...props} />;
  }

  return (
    <picture style={{ display: "contents" }}>
      <source srcSet={webp} type="image/webp" />
      <img src={src} alt={alt} loading={loading} decoding={decoding} {...props} />
    </picture>
  );
}