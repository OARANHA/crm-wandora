/**
 * A etiqueta "Grupo" na lista de conversas.
 *
 * `conversations.is_group` já chega no `SELECT_COLS` do handler (schema
 * original) — este teste prende só a LEITURA na tela: quem abre o inbox
 * precisa distinguir uma conversa de grupo de uma individual sem abrir cada
 * uma. Props mínimas copiadas de `ConversationList.tsx`, via
 * `__fixtures__/conversa.ts`.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConversationListItem } from "./ConversationListItem";
import { conversaDeExemplo } from "./__fixtures__/conversa";

describe("ConversationListItem — etiqueta de grupo", () => {
  it("conversa de grupo tem a etiqueta Grupo", () => {
    render(
      <ConversationListItem
        conversation={{ ...conversaDeExemplo.conversation, is_group: true }}
        {...conversaDeExemplo.props}
      />,
    );
    expect(screen.getByText("Grupo")).toBeInTheDocument();
  });

  it("conversa individual não tem", () => {
    render(
      <ConversationListItem
        conversation={{ ...conversaDeExemplo.conversation, is_group: false }}
        {...conversaDeExemplo.props}
      />,
    );
    expect(screen.queryByText("Grupo")).toBeNull();
  });
});

describe("ConversationListItem — rótulo do canal na lista", () => {
  it("prefere o nome que a organização deu ao número", () => {
    render(
      <ConversationListItem
        {...conversaDeExemplo.props}
        mostrarCanal
        conversation={{
          ...conversaDeExemplo.conversation,
          channel_sessions: {
            display_name: "Vendas",
            phone_number: "+5511988877766",
            provider: "waha",
          },
        }}
      />,
    );
    expect(screen.getByText("Vendas")).toBeInTheDocument();
    expect(screen.getByTitle("Entrou por Vendas")).toBeInTheDocument();
    expect(screen.queryByText("+5511988877766")).toBeNull();
  });
});
