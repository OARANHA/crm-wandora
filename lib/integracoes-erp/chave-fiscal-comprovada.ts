import type { NotaErp } from "./tipos";

/**
 * Compara a chave de 44 dígitos com o número fiscal retornado pela
 * mesma consulta ERP. NFe/NFCe: posições 26–34 da chave identificam nNF.
 * Não usa código interno do pedido ou ID do provider como identidade.
 */
export function chaveFiscalComprovadaDaNota(
  nota: Pick<NotaErp, "numero" | "chave">,
): string | null {
  const numero = nota.numero;
  const chave = nota.chave?.replace(/\D/g, "") ?? "";
  if (
    !/^\d{44}$/.test(chave) ||
    typeof numero !== "number" ||
    !Number.isSafeInteger(numero) ||
    numero <= 0 ||
    numero > 999_999_999 ||
    chave.slice(25, 34) !== String(numero).padStart(9, "0")
  ) {
    return null;
  }
  return chave;
}
