import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxFiltersValue } from "@/components/inbox/InboxFilters";

const auth = vi.hoisted(() => ({ role: "manager" }));

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (key: string) => key }));
vi.mock("@/hooks/channels/useChannelSessions", () => ({
  useChannelSessions: () => ({ data: [] }),
  channelLabel: () => "",
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({
    activeOrg: { orgId: "org-teste", role: auth.role, visibility_mode: "all" },
  }),
}));
vi.mock("@/hooks/inbox/useConversationTags", () => ({
  useConversationTagVocabulary: () => ({ data: [] }),
}));
vi.mock("@/hooks/contacts/useContactTagVocabulary", () => ({
  useContactTagVocabulary: () => ({ data: [] }),
}));
vi.mock("@/hooks/inbox/useConversationCounts", () => ({
  useConversationCounts: () => ({ data: undefined }),
}));
// Isola o gate do componente InboxFilters; o seletor real é portado do upstream.
vi.mock("@/components/inbox/SeletorDeAtendente", () => ({
  SeletorDeAtendente: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange("bf49a9c8-9fbd-448c-8a94-4db4b14b7219")}>
      Escolher atendente
    </button>
  ),
}));

const { InboxFilters } = await import("@/components/inbox/InboxFilters");

function Arnes() {
  const [value, setValue] = useState<InboxFiltersValue>({
    tab: "all",
    search: "",
    onlyUnread: false,
  });
  return (
    <>
      <InboxFilters value={value} onChange={setValue} />
      <output data-testid="atendente-aplicado">{value.assigned_to ?? "nenhum"}</output>
    </>
  );
}

beforeEach(() => {
  auth.role = "manager";
});
afterEach(cleanup);

describe("Inbox: filtro por atendente depende da autoridade da organização", () => {
  it("gerente vê o seletor e a escolha entra no estado aplicado", () => {
    render(<Arnes />);
    fireEvent.click(screen.getByRole("button", { name: "Escolher atendente" }));
    expect(screen.getByTestId("atendente-aplicado")).toHaveTextContent(
      "bf49a9c8-9fbd-448c-8a94-4db4b14b7219",
    );
  });

  it("atendente comum não recebe o seletor de gerência", () => {
    auth.role = "agent";
    render(<Arnes />);
    expect(screen.queryByRole("button", { name: "Escolher atendente" })).toBeNull();
  });
});
