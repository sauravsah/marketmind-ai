export function buildStrategyContext({ strategy, brand, workspace = {} }) {
  return {
    strategy: {
      id: strategy.id,
      idea: strategy.idea,
      audience: strategy.audience || workspace.defaultAudience,
      platforms: strategy.platforms?.length ? strategy.platforms : workspace.defaultPlatform ? [workspace.defaultPlatform] : [],
      objective: strategy.objective || workspace.defaultObjective,
      market: strategy.market || workspace.defaultMarket,
      competitors: strategy.competitors || [],
      researchDepth: strategy.researchDepth || 'balanced',
    },
    brand: {
      name: brand.name,
      industry: brand.industry,
      description: brand.description,
      website: brand.website,
      audience: brand.audience,
      voice: brand.voice,
    },
  };
}
