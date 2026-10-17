import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConversationListItem } from "@/components/inbox/ConversationListItem";
import { conversaDeExemplo } from "@/components/inbox/__fixtures__/conversa";

const conversa = conversaDeExemplo.conversation;
const props = conversaDeExemplo.props;

describe("ConversationListItem — estado do ponto de comando acessível", () => {
  it("nomeia o automático sem depender só da cor roxa", () => {
    render(<ConversationListItem {...props} conversation={conversa} />);
    const estado = screen.getByRole("img", { name: "Automático atendendo" });
    expect(estado).toHaveAttribute("title", "Automático atendendo");
    expect(estado).not.toHaveAttribute("aria-hidden");
  });

  it("nomeia o atendimento humano atribuído", () => {
    render(
      <ConversationListItem
        {...props}
        conversation={{ ...conversa, assigned_to_user_id: "agente-1" }}
      />,
    );
    expect(screen.getByRole("img", { name: "Em atendimento" })).toBeInTheDocument();
  });

  it("quando fechada com dono histórico, não afirma atendimento em andamento", () => {
    render(
      <ConversationListItem
        {...props}
        conversation={{
          ...conversa,
          status: "closed",
          assigned_to_user_id: "agente-1",
        }}
      />,
    );
    expect(screen.getByRole("img", { name: "Encerrada" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Em atendimento" })).toBeNull();
  });

  it("sem automático ativo, descreve o estado real de falta de atendente", () => {
    render(
      <ConversationListItem
        {...props}
        conversation={conversa}
        automaticoDaOrg={false}
      />,
    );
    expect(screen.getByRole("img", { name: "Sem atendente" })).toBeInTheDocument();
  });

  it("grupo sem responsável não é anunciado como conversa com automático", () => {
    render(
      <ConversationListItem
        {...props}
        conversation={{ ...conversa, is_group: true }}
      />,
    );
    expect(screen.getByRole("img", { name: "Aguardando atendente" })).toBeInTheDocument();
  });
});
