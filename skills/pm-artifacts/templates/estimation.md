{{macro:notice}}

{{macro:preliminary}}

## Summary

|                              | MVP                                                                                                             | Full scope                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Story-map items              | {{figure:scope.mvp.items}}                                                                                      | {{figure:scope.full.items}}                                                                                        |
| Expected size (story points) | {{figure:scope.mvp.points}}                                                                                     | {{figure:scope.full.points}}                                                                                       |
| Sprints at P50 / P85 / P95   | {{figure:forecast.mvp.sprints.p50}} / {{figure:forecast.mvp.sprints.p85}} / {{figure:forecast.mvp.sprints.p95}} | {{figure:forecast.full.sprints.p50}} / {{figure:forecast.full.sprints.p85}} / {{figure:forecast.full.sprints.p95}} |
| Done by at P50 / P85 / P95   | {{figure:forecast.mvp.date.p50}} / {{figure:forecast.mvp.date.p85}} / {{figure:forecast.mvp.date.p95}}          | {{figure:forecast.full.date.p50}} / {{figure:forecast.full.date.p85}} / {{figure:forecast.full.date.p95}}          |
| Cost at P50 / P85            |                                                                                                                 | {{figure:budget.total.p50}} / {{figure:budget.total.p85}}                                                          |

Deadline: {{figure:deadline}}.

## Preliminary effort estimates

Three-point estimates in story points (O optimistic, M most likely, P pessimistic; E = (O + 4M + P) / 6), sized against the team's reference stories.

{{table:story_map}}

## Dependencies and sequencing

{{text:sequencing}}

{{table:dependencies}}

## Team capacity assumptions

{{table:capacity}}

{{table:resources}}

## Estimated timeline and release forecast

Monte Carlo forecast with {{figure:forecast.trials}} trials: scope from each item's three-point estimate, velocity resampled from the team's past sprints at the capacity share for this Epic.

{{table:forecast}}

Current release {{figure:roadmap.release}}: done by {{figure:roadmap.finish_without}} without this feature and by {{figure:roadmap.finish_with}} with it ({{figure:roadmap.delay}} later). Launch target {{figure:roadmap.launch_target}}: {{figure:roadmap.launch_at_risk}}.

## Budget estimate

{{table:budget_roles}}

{{table:budget_non_labour}}

{{table:budget_total}}

## Confidence and forecast assumptions

{{text:confidence}}

{{list:forecast_assumptions}}
