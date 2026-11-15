import { describe, expect, it } from "vitest";
import { classifyTool, tokenize } from "../src/classifier.js";
import { PRESETS } from "../src/presets/index.js";

const preset = (id: string) => {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`no preset ${id}`);
  return p;
};

describe("tokenize", () => {
  it("splits on _, - and camelCase", () => {
    expect(tokenize("delete_file")).toEqual(["delete", "file"]);
    expect(tokenize("force-push")).toEqual(["force", "push"]);
    expect(tokenize("createOrUpdateFile")).toEqual(["create", "or", "update", "file"]);
    expect(tokenize("getHTTPStatus")).toEqual(["get", "http", "status"]);
    expect(tokenize("list.items")).toEqual(["list", "items"]);
  });
});

describe("classifyTool: verb heuristics", () => {
  it.each([
    ["delete_thing", "critical"],
    ["remove_user", "critical"],
    ["dropTable", "critical"],
    ["destroy-cluster", "critical"],
    ["purge_cache", "critical"],
    ["truncate_table", "critical"],
    ["force_push", "critical"],
    ["push_force", "critical"],
    ["merge_pull_request", "critical"],
    ["create_issue", "write"],
    ["update_page", "write"],
    ["write_file", "write"],
    ["edit_file", "write"],
    ["push_files", "write"],
    ["send_message", "write"],
    ["post_comment", "write"],
    ["publish_package", "write"],
    ["execute_sql", "write"],
    ["run_command", "write"],
    ["exec", "write"],
    ["shell", "write"],
    ["transfer_funds", "write"],
    ["get_issue", "read"],
    ["list_files", "read"],
    ["search_code", "read"],
    ["read_file", "read"],
    ["fetch_url", "read"],
    ["describe_table", "read"],
    ["frobnicate", "unknown"],
  ])("%s -> %s", (name, risk) => {
    expect(classifyTool({ name }).risk).toBe(risk);
  });

  it("records a reason and source", () => {
    const c = classifyTool({ name: "delete_thing" });
    expect(c.source).toBe("verb");
    expect(c.reason).toMatch(/delete/);
  });

  it("does not treat 'get_deleted_items' as critical (first verb wins)", () => {
    expect(classifyTool({ name: "get_deleted_items" }).risk).toBe("read");
  });
});

describe("classifyTool: annotations", () => {
  it("destructiveHint:true is critical even for a harmless-looking name", () => {
    const c = classifyTool({ name: "frobnicate", annotations: { destructiveHint: true } });
    expect(c.risk).toBe("critical");
    expect(c.source).toBe("annotation");
    expect(c.reason).toMatch(/destructiveHint/);
  });

  it("readOnlyHint:true is read", () => {
    const c = classifyTool({ name: "frobnicate", annotations: { readOnlyHint: true } });
    expect(c.risk).toBe("read");
    expect(c.source).toBe("annotation");
  });

  it("annotations beat verb heuristics", () => {
    expect(classifyTool({ name: "delete_cache", annotations: { readOnlyHint: true } }).risk).toBe(
      "read",
    );
    expect(classifyTool({ name: "get_thing", annotations: { destructiveHint: true } }).risk).toBe(
      "critical",
    );
  });

  it("destructiveHint:false alone does not downgrade a verb match", () => {
    expect(classifyTool({ name: "delete_x", annotations: { destructiveHint: false } }).risk).toBe(
      "critical",
    );
  });
});

describe("classifyTool: description tiebreaker", () => {
  it("only used when the name gives no verb", () => {
    // Descriptions are weak evidence: a mention of deleting asks, never denies.
    expect(
      classifyTool({ name: "frobnicate", description: "Permanently deletes the record" }).risk,
    ).toBe("write");
    expect(classifyTool({ name: "frobnicate", description: "Sends an email to a user" }).risk).toBe(
      "write",
    );
    expect(
      classifyTool({ name: "frobnicate", description: "Returns the current weather" }).risk,
    ).toBe("read");
  });

  it("never escalates to critical from the description alone (real kicad false positive)", () => {
    const c = classifyTool({
      name: "suggest_placement",
      description: "Suggest component placement without deleting or moving existing parts",
    });
    expect(c.risk).not.toBe("critical");
  });

  it("treats clear/reset/overwrite as critical and common mutators as write", () => {
    expect(classifyTool({ name: "clear_board_outline" }).risk).toBe("critical");
    expect(classifyTool({ name: "reset_database" }).risk).toBe("critical");
    expect(classifyTool({ name: "overwrite_file" }).risk).toBe("critical");
    for (const n of [
      "replace_component",
      "import_pcb",
      "duplicate_component",
      "copy_routing_pattern",
      "connect_to_net",
      "rotate_component",
      "sync_schematic_to_board",
      "generate_netlist",
    ]) {
      expect(classifyTool({ name: n }).risk, n).toBe("write");
    }
  });

  it("does not override a name verb", () => {
    expect(classifyTool({ name: "get_thing", description: "Deletes things" }).risk).toBe("read");
  });
});

describe("classifyTool: presets", () => {
  it("classifies the git preset tools", () => {
    const git = preset("git");
    expect(classifyTool({ name: "git_reset" }, git)).toMatchObject({
      risk: "critical",
      source: "preset",
    });
    for (const name of ["git_commit", "git_add", "git_checkout", "git_create_branch"]) {
      const c = classifyTool({ name }, git);
      expect(c.risk, name).toBe("write");
      expect(c.source, name).toBe("preset");
    }
    for (const name of ["git_status", "git_diff", "git_diff_staged", "git_log", "git_show"]) {
      expect(classifyTool({ name }, git).risk, name).toBe("read");
    }
  });

  it("preset overrides annotations and heuristics", () => {
    const gh = preset("github");
    const c = classifyTool({ name: "merge_pull_request", annotations: { readOnlyHint: true } }, gh);
    expect(c.risk).toBe("critical");
    expect(c.source).toBe("preset");
  });

  it("postgres query is write, drop is critical", () => {
    const pg = preset("postgres");
    expect(classifyTool({ name: "query" }, pg).risk).toBe("write");
    expect(classifyTool({ name: "execute_sql" }, pg).risk).toBe("write");
    expect(classifyTool({ name: "drop_table" }, pg).risk).toBe("critical");
  });

  it("falls through to heuristics for tools the preset does not name", () => {
    const c = classifyTool({ name: "get_something_new" }, preset("github"));
    expect(c.risk).toBe("read");
    expect(c.source).toBe("verb");
  });

  it("shell execute_command is critical", () => {
    expect(classifyTool({ name: "execute_command" }, preset("shell")).risk).toBe("critical");
  });
});
