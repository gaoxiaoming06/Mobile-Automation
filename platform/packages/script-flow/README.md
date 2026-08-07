# Script Flow

ScriptFlow v1 YAML parser, validator, compiler, and serializer.

ScriptFlow is the executable test-case source of truth. This package owns the document schema and deterministic compilation into execution plan steps. PageAsset can help identify pages and provide public context, but ScriptFlow YAML defines the actions, parameters, page assertions, reusable `runFlow` references, repeats, and conditional parameter branches.

Current scope:

- Parse and validate ScriptFlow v1 YAML.
- Serialize ScriptFlow documents back to YAML.
- Compile saved or draft flows into immutable execution plans.
- Expand reusable child flows through `runFlow` while preserving parent phase semantics.
- Support target forms based on visible text, icons, visual targets, controls, area/position, nearby text, scope text, ordinal, and search policy.
