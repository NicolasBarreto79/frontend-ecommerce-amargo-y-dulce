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
};

type StrapiSingleResponse<T> = {
  data:
    | {
        id: number;
        attributes: T;
      }
    | null;
};

function getHomeSlidesFromPublic() {
  try {
    const dir = path.join(process.cwd(), "public", "home");
    if (!fs.existsSync(dir)) return [];

    const files = fs
      .readdirSync(dir)
      .filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
      .sort((a, b) => a.localeCompare(b)); // orden estable

    // Convertimos a /home/archivo.ext
    const images = files.map((f) => `/home/${f}`);

    // ✅ Metadata por índice (0,1,2...) para que cada slide tenga su cartel.
    // Si hay más imágenes, repite la 1ra metadata como fallback.
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

    const raw = res?.data?.attributes?.bestSellers ?? [];
    bestSellers = Array.isArray(raw) ? raw.map(toCardItem) : [];
  } catch {
    bestSellers = [];
  }

  // ✅ Slides: auto desde /public/home/*
  let slides = getHomeSlidesFromPublic();

  // ✅ Fallback si no hay nada en /public/home
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
      {/* ✅ CARRUSEL */}
      <Container>
        <div className="pt-8">
          <HeroCarousel slides={slides} intervalMs={4500} />
        </div>
      </Container>

      {/* HERO / PRESENTACIÓN */}
      <Container>
        <div className="py-10">
          <h1 className="text-3xl font-bold">Amargo y Dulce</h1>
          <p className="mt-2 text-neutral-600">
            Base de Next.js lista para conectar con Strapi.
          </p>

          <div className="mt-6 flex gap-3">
            <Link className="rounded-md bg-red-600 px-4 py-2 text-white" href="/productos">
              Ver productos
            </Link>

            <Link className="rounded-md border px-4 py-2" href="/login">
              Iniciar sesión
            </Link>
          </div>
        </div>
      </Container>

      {/* BANDA DE INFORMACIÓN */}
      <Container>
        <div className="mb-10">
          <InfoStrip />
        </div>
      </Container>

      {/* PRODUCTOS MÁS COMPRADOS */}
      <Container>
        <HomeBestSellers products={bestSellers} />
      </Container>
    </>
  );
}
