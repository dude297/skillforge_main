# The reference skill's own tests run inside the skill sandbox (they `import helper`), not under the repo's pytest.
collect_ignore_glob = ["reference_skill/*"]
