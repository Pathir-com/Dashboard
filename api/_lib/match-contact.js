/**
 * Find or create a contact for a practice.
 * Matches by phone number first, then email, then creates new.
 * Returns the contact record.
 */
export async function findOrCreateContact(adminClient, { practiceId, name, phone, email, source }) {
  // 1. Try matching by phone
  if (phone) {
    const { data: byPhone } = await adminClient
      .from("contacts")
      .select("*")
      .eq("practice_id", practiceId)
      .eq("phone", phone)
      .limit(1)
      .single();

    if (byPhone) {
      // Update name/email if we have new info
      const updates = {};
      if (name && !byPhone.name) updates.name = name;
      if (email && !byPhone.email) updates.email = email;
      if (Object.keys(updates).length > 0) {
        await adminClient.from("contacts").update(updates).eq("id", byPhone.id);
      }
      return byPhone;
    }
  }

  // 2. Try matching by email
  if (email) {
    const { data: byEmail } = await adminClient
      .from("contacts")
      .select("*")
      .eq("practice_id", practiceId)
      .eq("email", email)
      .limit(1)
      .single();

    if (byEmail) {
      const updates = {};
      if (name && !byEmail.name) updates.name = name;
      if (phone && !byEmail.phone) updates.phone = phone;
      if (Object.keys(updates).length > 0) {
        await adminClient.from("contacts").update(updates).eq("id", byEmail.id);
      }
      return byEmail;
    }
  }

  // 3. Create new contact
  const { data: newContact, error } = await adminClient
    .from("contacts")
    .insert({
      practice_id: practiceId,
      name: name || "Unknown",
      phone: phone || null,
      email: email || null,
      source: source || "chat",
    })
    .select()
    .single();

  if (error) throw error;
  return newContact;
}

/**
 * Get all previous enquiries for a contact, across all channels.
 * Returns them in chronological order with conversation history.
 */
export async function getContactHistory(adminClient, contactId) {
  const { data: enquiries } = await adminClient
    .from("enquiries")
    .select("id, source, message, conversation, created_at, is_completed")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: true });

  return enquiries || [];
}
