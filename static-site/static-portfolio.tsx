import React from "react";
import type { MediaAsset, PortfolioDocument, ProjectBlock } from "../app/portfolio/model";

export function StaticPortfolio({ portfolio, workerAdminUrl }: { portfolio: PortfolioDocument; workerAdminUrl?: string }) {
  const contact = portfolio.settings.contact;
  return <main>
    <header className="hero" aria-labelledby="portfolio-title">
      <div className="hero-copy">
        {visible(portfolio.hero.role) && <p className="eyebrow">{portfolio.hero.role}</p>}
        <h1 id="portfolio-title">{portfolio.hero.name}</h1>
        {visible(portfolio.hero.targetRole) && <p className="target-role">{portfolio.hero.targetRole}</p>}
        {visible(portfolio.hero.statement) && <p>{portfolio.hero.statement}</p>}
        {visible(portfolio.hero.availability) && <p className="availability">{portfolio.hero.availability}</p>}
      </div>
      <div className="hero-media">
        {portfolio.hero.slides.map((slide, index) => <Media key={slide.id} asset={slide.media} priority={index === 0} />)}
      </div>
    </header>

    <section className="works" aria-labelledby="works-title">
      <header className="section-heading"><p>{portfolio.settings.workHeading.lead}</p><h2 id="works-title">{portfolio.settings.workHeading.accent}</h2></header>
      {portfolio.categories.map((category) => <section className="category" key={category.id} style={{ "--category-accent": category.accent } as React.CSSProperties}>
        <div className="category-heading"><h2>{category.label}</h2><Media asset={category.transition.media} decorative /></div>
        {portfolio.projects.filter((project) => project.categoryId === category.id).sort((left, right) => left.order - right.order).map((project) => <article className="project" key={project.id}>
          <Media asset={project.cover} priority />
          <header className="project-heading">
            <div><h3>{project.title}</h3>{visible(project.synopsis) && <p>{project.synopsis}</p>}</div>
            <dl><div><dt>年份</dt><dd>{project.year}</dd></div><div><dt>周期</dt><dd>{project.duration}</dd></div></dl>
          </header>
          {(visible(project.challenge) || visible(project.solution)) && <div className="project-summary">
            {visible(project.challenge) && <section><h4>项目难点</h4><p>{project.challenge}</p></section>}
            {visible(project.solution) && <section><h4>解决思路</h4><p>{project.solution}</p></section>}
          </div>}
          {project.finalVideo.src && <figure className="video"><video controls playsInline preload="metadata" src={project.finalVideo.src} /><figcaption>{project.finalVideo.alt}</figcaption></figure>}
          <div className="project-blocks">{project.detailBlocks.map((block) => <ContentBlock key={block.id} block={block} />)}</div>
        </article>)}
      </section>)}
    </section>

    {portfolio.endCovers.enabled && portfolio.endCovers.slides.length > 0 && <section className="end-covers" aria-label="封底">
      {portfolio.endCovers.slides.map((slide) => <article key={slide.id}><Media asset={slide.media} />
        <div>{visible(slide.title) && <h2>{slide.title}</h2>}{visible(slide.statement) && <p>{slide.statement}</p>}{visible(slide.details) && <p>{slide.details}</p>}</div>
      </article>)}
    </section>}

    <section className="contact" data-layout={contact.layout} aria-labelledby="contact-title">
      <Media asset={contact.image} />
      <div>{visible(contact.eyebrow) && <p className="eyebrow">{contact.eyebrow}</p>}
        {visible(contact.title) && <h2 id="contact-title">{contact.title}</h2>}
        {visible(portfolio.hero.email) && <a href={`mailto:${portfolio.hero.email}`}>{portfolio.hero.email}</a>}
        {visible(portfolio.hero.phone) && <a href={`tel:${portfolio.hero.phone.replace(/[^\d+]/gu, "")}`}>{portfolio.hero.phone}</a>}
        {visible(contact.note) && <p>{contact.note}</p>}
      </div>
    </section>

    <footer><strong>{portfolio.hero.name}</strong>{workerAdminUrl && <a href={workerAdminUrl} data-worker-admin-link>管理作品</a>}</footer>
  </main>;
}

function ContentBlock({ block }: { block: ProjectBlock }) {
  if (block.type === "text") return visible(block.eyebrow) || visible(block.title) || visible(block.body)
    ? <section className="text-block">{visible(block.eyebrow) && <p className="eyebrow">{block.eyebrow}</p>}{visible(block.title) && <h4>{block.title}</h4>}{visible(block.body) && <p>{block.body}</p>}</section> : null;
  if (block.type === "media-text") return <section className="media-text" data-side={block.side}><Media asset={block.media} /><div>
    {visible(block.eyebrow) && <p className="eyebrow">{block.eyebrow}</p>}{visible(block.title) && <h4>{block.title}</h4>}{visible(block.body) && <p>{block.body}</p>}
  </div></section>;
  if (block.type === "gallery") return <section className="gallery" data-orientation={block.orientation}>
    {(visible(block.eyebrow) || visible(block.title)) && <header>{visible(block.eyebrow) && <p className="eyebrow">{block.eyebrow}</p>}{visible(block.title) && <h4>{block.title}</h4>}</header>}
    <div>{block.items.map((asset) => <Media key={asset.id} asset={asset} />)}</div>
  </section>;
  return <figure className="full-media"><Media asset={block.media} />{visible(block.caption) && <figcaption>{block.caption}</figcaption>}</figure>;
}

function Media({ asset, priority = false, decorative = false }: { asset: MediaAsset; priority?: boolean; decorative?: boolean }) {
  if (!asset.src || asset.kind === "font") return null;
  if (asset.kind === "video") return <video controls playsInline preload="metadata" src={asset.src} aria-label={asset.alt} />;
  // This is a standalone Vite export, so Next.js Image is not available at runtime.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={asset.src} alt={decorative ? "" : asset.alt} loading={priority ? "eager" : "lazy"} decoding="async"
    style={{ objectPosition: `${asset.objectPosition?.x ?? 50}% ${asset.objectPosition?.y ?? 50}%` }} />;
}

function visible(value: string) { return value.trim().length > 0; }
