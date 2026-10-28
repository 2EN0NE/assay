import { DefaultSeo } from "next-seo"

export default function Meta() {
  return (
    <DefaultSeo
      titleTemplate="%s - 试金石"
      defaultTitle="试金石"
      description="Track your predictions, make better decisions."
      canonical="https://localhost:3000/"
      openGraph={{
        type: "website",
        locale: "en_US",
        url: "https://localhost:3000/",
        title: "试金石",
        description: "Track your predictions, make better decisions.",
        siteName: "试金石",
        images: [
          {
            url: "https://localhost:3000/telescope_future_1200_white.png",
            width: 1200,
            height: 686,
            alt: "",
          },
        ],
      }}
      additionalLinkTags={[
        {
          rel: "icon",
          href: "https://localhost:3000/scale.svg",
        },
      ]}
      twitter={{
        handle: "@sage_future_",
      }}
    />
  )
}
