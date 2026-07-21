module.exports = function (eleventyConfig) {
  // Copy static assets straight through to the output: /assets/...
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });

  // Take the first n items of an array (e.g. recent publications on the home page).
  eleventyConfig.addFilter("limit", (arr, n) => (arr || []).slice(0, n));

  // Build a canonical link for a publication: the journal / DOI landing page
  // for the paper (falling back to PMID or an explicit url). The direct PDF,
  // when available, is offered separately as its own link (see pub.pdf).
  eleventyConfig.addFilter("pubLink", (pub) => {
    if (!pub) return null;
    if (pub.doi) return `https://doi.org/${pub.doi}`;
    if (pub.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`;
    return pub.url || null;
  });

  // Year of the build, so the publications page can split papers into rolling
  // "recent" vs "earlier" buckets that re-sort themselves on each rebuild.
  eleventyConfig.addGlobalData("buildYear", () => new Date().getFullYear());

  // Partition a list of {year} records relative to a cutoff year.
  eleventyConfig.addFilter("sinceYear", (arr, year) =>
    (arr || []).filter((item) => item.year >= year)
  );
  eleventyConfig.addFilter("beforeYear", (arr, year) =>
    (arr || []).filter((item) => item.year < year)
  );

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["njk", "md", "html"],
  };
};
