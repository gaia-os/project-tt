# Graph comparison: `smr` vs `smr-qwen38-next-flash`

## 1. Structural overview

| metric | smr | smr-qwen38-next-flash |
| --- | --- | --- |
| nodes | 1968 | 1323 |
| edges | 9922 | 5462 |
| max_level observed | 113 | 32 |
| verified edges | 2017 | 1511 |
| verified edge % | 20.3% | 27.7% |
| importance mean | 0.228 | 0.139 |
| importance max | 1.0 | 1.0 |

### Nodes by label

| label | smr | smr-qwen38-next-flash |
| --- | --- | --- |
| Technology | 1643 | 995 |
| Organisation | 222 | 225 |
| ReactorDesign | 103 | 103 |
| (other) | 0 | 0 |

### Nodes by origin

| origin | smr | smr-qwen38-next-flash |
| --- | --- | --- |
| (none) | 325 | 328 |
| llm_inferred | 760 | 333 |
| source_document | 883 | 662 |

### Nodes by category (top 12)

| category | smr | smr-qwen38-next-flash |
| --- | --- | --- |
| component | 481 | 336 |
| (none) | 325 | 328 |
| system | 268 | 145 |
| material | 246 | 136 |
| process | 199 | 101 |
| manufacturing | 117 | 88 |
| instrumentation_control | 120 | 65 |
| software_method | 123 | 48 |
| fuel | 89 | 76 |

### Edges by type

| type | smr | smr-qwen38-next-flash |
| --- | --- | --- |
| ENABLES | 6731 | 3896 |
| BROADER | 2683 | 1129 |
| SUPPLIES | 390 | 319 |
| DEVELOPS | 118 | 118 |
| (other) | 0 | 0 |

### Edges by relation_type (sub-type)

| relation_type | smr | smr-qwen38-next-flash |
| --- | --- | --- |
| (none) | 5260 | 3157 |
| material | 1218 | 686 |
| sub_component | 1051 | 520 |
| design_method | 736 | 216 |
| manufacturing_process | 641 | 438 |
| qualification_testing | 552 | 132 |
| enabling_process | 245 | 201 |
| fuel_cycle_input | 219 | 112 |

### Tree level distribution

| tree_level | smr | smr-qwen38-next-flash |
| --- | --- | --- |
| 1 | 881 | 659 |
| 2 | 440 | 239 |
| 3 | 97 | 20 |
| 4 | 8 | 2 |
| (none) | 542 | 403 |

## 2. Technology set overlap

| metric | value |
| --- | --- |
| Technologies in A | 1643 |
| Technologies in B | 995 |
| Shared by exact ID | 247 |
| Shared by normalised name | 247 |
| Only in A (by name) | 1396 |
| Only in B (by name) | 748 |
| Jaccard (IDs) | 0.103 |
| Jaccard (names) | 0.103 |
| Fuzzy name matches (>=0.88) | 85 |

Sidecar files: `shared_techs.csv`, `only_in_a.csv`, `only_in_b.csv`, `fuzzy_matches.csv`.


## 3. Per-reactor coverage (top 15 most divergent)

| reactor | enables A | enables B | techs A | techs B | src A | src B | A/B |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | 10 | 4 | 10 | 4 | 10 | 4 | 2.50 |
| SHELF-M | 25 | 12 | 25 | 12 | 25 | 12 | 2.08 |
| HAPPY200 | 28 | 15 | 28 | 15 | 28 | 15 | 1.87 |
| Rolls-Royce SMR | 33 | 18 | 33 | 18 | 33 | 18 | 1.83 |
| KLT-40S | 31 | 17 | 31 | 17 | 31 | 17 | 1.82 |
| HARPIA™ Nuclear Microreactor | 25 | 14 | 25 | 14 | 25 | 14 | 1.79 |
| UNITHERM | 25 | 14 | 25 | 14 | 25 | 14 | 1.79 |
| RI™-200N | 32 | 19 | 32 | 19 | 32 | 19 | 1.68 |
| CA Waste Burner | 25 | 15 | 25 | 15 | 25 | 15 | 1.67 |
| HTR-10 | 25 | 15 | 25 | 15 | 25 | 15 | 1.67 |
| SAIR | 25 | 15 | 25 | 15 | 25 | 15 | 1.67 |
| seaMSR-100 | 25 | 15 | 25 | 15 | 25 | 15 | 1.67 |
| Westinghouse eVinci™ Microreactor | 29 | 18 | 29 | 18 | 29 | 18 | 1.61 |
| LFR-AS-30 | 8 | 5 | 8 | 5 | 8 | 5 | 1.60 |
| NuScale Power Module™ | 24 | 15 | 24 | 15 | 24 | 15 | 1.60 |

Full table: `reactor_coverage.csv` (sorted by |A/B - 1|).


## 4. Edge agreement

| metric | value |
| --- | --- |
| Edges in A | 9922 |
| Edges in B | 5462 |
| Shared (s,t,type) triples | 744 |
| Jaccard over edges | 0.051 |

## 5. Importance-score deltas on shared technologies (top 15)

| technology | score A | score B | delta | reach A | reach B |
| --- | --- | --- | --- | --- | --- |
| gadolinium metal | 0.95 | 0.008 | 0.942 | 103 | 1 |
| conventional neutron absorber | 0.952 | 0.032 | 0.92 | 103 | 4 |
| chromium nickel alloy cladding | 0.912 | 0.01 | 0.902 | 103 | 1 |
| scada control system | 0.9 | 0.01 | 0.89 | 103 | 1 |
| surface treatment | 0.91 | 0.024 | 0.886 | 103 | 3 |
| digital twin | 0.9 | 0.019 | 0.881 | 103 | 2 |
| uranium hydride fuel | 0.008 | 0.889 | -0.881 | 1 | 100 |
| neutron moderator | 0.879 | 0.0 | 0.879 | 103 | 0 |
| oxygen control system | 0.008 | 0.871 | -0.863 | 1 | 99 |
| thermal testing | 0.852 | 0.0 | 0.852 | 103 | 0 |
| alloy 690 | 0.059 | 0.908 | -0.849 | 9 | 102 |
| lead coolant | 0.054 | 0.885 | -0.831 | 7 | 99 |
| fuel qualification | 0.8 | 0.01 | 0.79 | 103 | 1 |
| gas coolant | 0.788 | 0.0 | 0.788 | 103 | 0 |
| reactor simulator | 0.804 | 0.019 | 0.785 | 103 | 2 |

Full table: `shared_tech_importance.csv`.

