'use client';

import { useId, useState } from 'react';
import type { PublicFaqs } from '@/lib/api/types';

export function FaqAccordion({
  categories,
}: {
  categories: PublicFaqs['categories'];
}) {
  const idPrefix = useId();
  const [openItems, setOpenItems] = useState<Set<string>>(() => new Set());

  const toggleItem = (id: string) => {
    setOpenItems((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="faq-page__categories">
      {categories.map((category, categoryIndex) => (
        <section
          className="faq-page__category"
          key={category.category}
          aria-labelledby={`${idPrefix}-category-${categoryIndex}`}
        >
          <h2 id={`${idPrefix}-category-${categoryIndex}`}>
            {category.category}
          </h2>
          <div className="faq-page__list">
            {category.items.map((item, itemIndex) => {
              const itemId = `${categoryIndex}-${itemIndex}`;
              const questionId = `${idPrefix}-question-${itemId}`;
              const answerId = `${idPrefix}-answer-${itemId}`;
              const isOpen = openItems.has(itemId);

              return (
                <article className="faq-page__item" key={item.id}>
                  <h3>
                    <button
                      id={questionId}
                      className="faq-page__question"
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={answerId}
                      onClick={() => toggleItem(itemId)}
                    >
                      {item.question}
                      <span aria-hidden="true" className="faq-page__indicator">
                        {isOpen ? '−' : '+'}
                      </span>
                    </button>
                  </h3>
                  <div
                    id={answerId}
                    className="faq-page__answer"
                    role="region"
                    aria-labelledby={questionId}
                    hidden={!isOpen}
                  >
                    <p>{item.answer}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
