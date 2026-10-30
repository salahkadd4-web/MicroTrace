import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Icône d'écran d'accueil : la goutte sur le fond de la marque, marge de 20 %. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F4F6F7",
        }}
      >
        <svg width="108" height="108" viewBox="0 0 120 120">
          <path
            d="M60 10 C60 10 22 54 22 78 A38 38 0 0 0 98 78 C98 54 60 10 60 10 Z"
            fill="none"
            stroke="#0F2A3D"
            strokeWidth="6"
            strokeLinejoin="round"
          />
          <polyline
            points="30,82 44,82 50,68 57,94 64,56 71,82 90,82"
            fill="none"
            stroke="#E4572E"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polygon points="45,50 52,47 54,54 47,57" fill="#0E7C86" />
          <polygon points="71,98 78,95 79,102" fill="#0E7C86" />
          <polygon points="76,60 81,62 78,66" fill="#0E7C86" />
        </svg>
      </div>
    ),
    size,
  );
}
