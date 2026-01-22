import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { InfoStrip } from "@/components/home/InfoStrip";
import { HomeBestSellers } from "@/components/home/HomeBestSellers";
import { strapiGet } from "@/lib/strapi";
import { toCardItem } from "@/lib/strapi-mappers";
import { HeroCarousel } from "@/components/home/HeroCarousel";

import fs from "fs";
import path from "path";

type HomePageAttributes = {
  bestSellers?: any[];
  bestSellersTitle?: string | null;
  moreProductsText?: string | null;
};

type StrapiSingleResponse<T> = {
  data:
    | ({
        id: number;
        // v4
        attributes?: T;
        // v5 (plano)
      } & T)
    | null;
};

function getHomeSlidesFromPublic() {
  try {
    const dir = path.join(process.cwd(), "public", "home");
    if (!fs.existsSync(dir)) return [];

    const files = fs
      .readdirSync(dir)
      .filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
      .sort((a, b) => a.localeCompare(b));

    const images = files.map((f) => `/home/${f}`);

    const metaByIndex = [
      {
        alt: "Elegí tus favoritos",
        href: "/productos",
        title: "Elegí tus favoritos",
        subtitle: "Chocolates y bombones artesanales",
        cta: "Comprar ahora",
      },
      {
        alt: "Promociones",
        href: "/promociones",
        title: "Promociones",
        subtitle: "Ofertas por tiempo limitado",
        cta: "Ver promos",
      },
      {
        alt: "Nuevos productos",
        href: "/productos",
        title: "Nuevos productos",
        subtitle: "Descubrí lo último en la tienda",
        cta: "Ver productos",
      },
    ];

    return images.map((img, i) => {
      const meta = metaByIndex[i] ?? metaByIndex[0];
      return {
        id: `home-${i + 1}`,
        image: img,
        ...meta,
      };
    });
  } catch {
    return [];
  }
}

export default async function HomePage() {
  let bestSellers: any[] = [];

  try {
    const res = await strapiGet<StrapiSingleResponse<HomePageAttributes>>(
      "/api/home-page?populate[bestSellers][populate]=*"
    );

    // ✅ v4: res.data.attributes
    // ✅ v5: res.data (plano)
    const home = (res?.data?.attributes ?? res?.data) as HomePageAttributes | undefined;

    const raw = home?.bestSellers ?? [];
    bestSellers = Array.isArray(raw) ? raw.map(toCardItem) : [];
  } catch {
    bestSellers = [];
  }

  // Slides auto desde /public/home/*
  let slides = getHomeSlidesFromPublic();

  if (!slides.length) {
    slides = [
      {
        id: "s1",
        image: "/home/hero-1.jpg",
        alt: "Elegí tus favoritos",
        href: "/productos",
        title: "Elegí tus favoritos",
        subtitle: "Chocolates y bombones artesanales",
        cta: "Comprar ahora",
      },
      {
        id: "s2",
        image: "/home/hero-2.jpg",
        alt: "Promociones",
        href: "/promociones",
        title: "Promociones",
        subtitle: "Ofertas por tiempo limitado",
        cta: "Ver promos",
      },
      {
        id: "s3",
        image: "/home/hero-3.jpg",
        alt: "Nuevos productos",
        href: "/productos",
        title: "Nuevos productos",
        subtitle: "Descubrí lo último en la tienda",
        cta: "Ver productos",
      },
    ];
  }

  return (
      <>
        <Container>
          <div className="pt-8 pb-14">
            <HeroCarousel slides={slides} intervalMs={4500} />
          </div>
        </Container>
        <Container>
          <div className="-mt-10 relative z-10 mb-10">
            <InfoStrip />
          </div>
        </Container>
        <Container>
          <div className="pb-16">
            <HomeBestSellers products={bestSellers} />
          </div>
        </Container>
      </>
    );
  }
